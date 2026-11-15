/**
 * Bounding boxes on the Earth. A box can cross the antimeridian: then its west is more than its east.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import {
  checkBBox,
  checkGeoJsonBBox,
  checkPosition,
  MAX_GEOJSON_DEPTH,
  type GeoJson,
  type GeoJsonBBox,
  type Geometry,
} from "./geojson.ts";
import { checkPoint, normalizeLon, type LatLon } from "./point.ts";

/**
 * A bounding box in degrees. The latitudes are from -90 to 90, and `south` is not more than `north`. The longitudes are
 * from -180 to 180. When `west` is more than `east`, the box crosses the antimeridian (RFC 7946, section 5.2).
 */
export interface BBox {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/** The longitude intervals and the latitude range that a bounding box collects. */
class Extent {
  private readonly intervals: [number, number][] = [];
  private south = Number.POSITIVE_INFINITY;
  private north = Number.NEGATIVE_INFINITY;

  /** It adds a point. */
  point(lon: number, lat: number): void {
    this.span(lon, lon, lat, lat);
  }

  /** It adds the edge between two positions. The edge is a straight line in longitude and latitude (RFC 7946). */
  edge(from: readonly number[], to: readonly number[]): void {
    const x1 = from[0] as number;
    const x2 = to[0] as number;
    this.span(Math.min(x1, x2), Math.max(x1, x2), from[1] as number, to[1] as number);
  }

  private span(start: number, end: number, lat1: number, lat2: number): void {
    this.south = Math.min(this.south, lat1, lat2);
    this.north = Math.max(this.north, lat1, lat2);
    if (end - start >= 360) {
      this.intervals.push([-180, 180]);
      return;
    }
    const west = normalizeLon(start);
    const east = west + (end - start);
    if (east <= 180) {
      this.intervals.push([west, east]);
    } else {
      this.intervals.push([west, 180], [-180, east - 360]);
    }
  }

  /** It gives the smallest box that has each interval: the circle without its largest gap. */
  box(): BBox | undefined {
    if (this.intervals.length === 0) return undefined;
    const sorted = [...this.intervals].sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [start, end] of sorted) {
      const last = merged[merged.length - 1];
      if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    const first = merged[0] as [number, number];
    const final = merged[merged.length - 1] as [number, number];
    // The gap across the antimeridian wins a tie, so the box does not cross the antimeridian without a need.
    let gap = first[0] + 360 - final[1];
    let west = first[0];
    let east = final[1];
    for (let index = 0; index + 1 < merged.length; index += 1) {
      const left = merged[index] as [number, number];
      const right = merged[index + 1] as [number, number];
      if (right[0] - left[1] > gap) {
        gap = right[0] - left[1];
        west = right[0];
        east = left[1];
      }
    }
    if (gap <= 0) return { west: -180, south: this.south, east: 180, north: this.north };
    // The longitude -180 is the longitude 180. A box that ends there does not cross the antimeridian.
    if (east === -180 && west > east) east = 180;
    return { west, south: this.south, east, north: this.north };
  }
}

/**
 * This function gives the smallest bounding box of the points. A box crosses the antimeridian when that makes it
 * narrower. For an empty array, the result is `undefined`.
 *
 * @throws GeoError - The code is `not-finite` or `latitude-range`.
 */
export function bboxOfPoints(points: readonly LatLon[]): BBox | undefined {
  const extent = new Extent();
  points.forEach((point, index) => {
    checkPoint(point, `[${index}]`);
    extent.point(point.lon, point.lat);
  });
  return extent.box();
}

function addPositions(extent: Extent, positions: readonly (readonly number[])[], path: string, edges: boolean): void {
  positions.forEach((position, index) => {
    checkPosition(position, `${path}[${index}]`);
    const previous = positions[index - 1];
    if (edges && previous !== undefined) extent.edge(previous, position);
    else extent.point(position[0] as number, position[1] as number);
  });
}

function addGeometry(extent: Extent, geometry: Geometry, path: string, depth: number): void {
  const coordinates = path === "" ? "coordinates" : `${path}.coordinates`;
  switch (geometry.type) {
    case "Point":
      checkPosition(geometry.coordinates, coordinates);
      extent.point(geometry.coordinates[0], geometry.coordinates[1]);
      break;
    case "MultiPoint":
      addPositions(extent, geometry.coordinates, coordinates, false);
      break;
    case "LineString":
      addPositions(extent, geometry.coordinates, coordinates, true);
      break;
    case "MultiLineString":
    case "Polygon":
      geometry.coordinates.forEach((line, index) => addPositions(extent, line, `${coordinates}[${index}]`, true));
      break;
    case "MultiPolygon":
      geometry.coordinates.forEach((polygon, index) =>
        polygon.forEach((ring, ringIndex) => addPositions(extent, ring, `${coordinates}[${index}][${ringIndex}]`, true)),
      );
      break;
    case "GeometryCollection":
      if (depth >= MAX_GEOJSON_DEPTH) throw new GeoError("too-deep", "The collections are nested too deep", path);
      geometry.geometries.forEach((child, index) =>
        addGeometry(extent, child, `${path === "" ? "" : `${path}.`}geometries[${index}]`, depth + 1),
      );
      break;
    default:
      throw new GeoError("geojson-type", "The value is not a GeoJSON geometry", path);
  }
}

/**
 * This function gives the smallest bounding box of a GeoJSON object. It reads the coordinates, not the member `bbox`.
 *
 * - Each edge of a line or a ring is a straight line in longitude and latitude (RFC 7946, section 3.1). So an edge from
 *   170 to -170 goes through 0. RFC 7946 (section 3.1.9) cuts a geometry at the antimeridian. Longitudes past 180
 *   are a second way to cross it.
 * - A box crosses the antimeridian when that makes it narrower.
 * - When the longitudes cover the full circle, the box is from -180 to 180, as for a polygon around a pole (RFC 7946,
 *   section 5.3).
 *
 * @returns The box, or `undefined` when the object has no position.
 * @throws GeoError - The code is `not-finite`, `latitude-range`, `position` or `too-deep`.
 */
export function bboxOfGeoJson(geojson: GeoJson): BBox | undefined {
  const extent = new Extent();
  if (geojson.type === "Feature") {
    if (geojson.geometry !== null) addGeometry(extent, geojson.geometry, "geometry", 0);
  } else if (geojson.type === "FeatureCollection") {
    geojson.features.forEach((feature, index) => {
      if (feature.geometry !== null) addGeometry(extent, feature.geometry, `features[${index}].geometry`, 0);
    });
  } else {
    addGeometry(extent, geojson, "", 0);
  }
  return extent.box();
}

/** It gives `true` when the longitude is in the closed arc from `west` to `east`. The longitude -180 is 180. */
function arcHas(west: number, east: number, lon: number): boolean {
  const test = (x: number): boolean => (west <= east ? west <= x && x <= east : x >= west || x <= east);
  return test(lon) || (Math.abs(lon) === 180 && test(-lon));
}

/**
 * This function gives `true` when the closed box has the point. A box that reaches a pole has the pole for each
 * longitude.
 *
 * @throws GeoError - The code is `not-finite`, `longitude-range`, `latitude-range` or `bbox`.
 */
export function bboxContains(box: BBox, point: LatLon): boolean {
  checkBBox(box);
  checkPoint(point);
  if (point.lat < box.south || point.lat > box.north) return false;
  if (Math.abs(point.lat) === 90) return true;
  return arcHas(box.west, box.east, normalizeLon(point.lon));
}

/**
 * This function gives `true` when the two closed boxes have a common point. Two boxes that touch on an edge have a
 * common point. Two boxes that reach the same pole have the pole.
 *
 * @throws GeoError - The code is `not-finite`, `longitude-range`, `latitude-range` or `bbox`.
 */
export function bboxIntersects(a: BBox, b: BBox): boolean {
  checkBBox(a, "a");
  checkBBox(b, "b");
  if (a.north < b.south || b.north < a.south) return false;
  if ((a.north === 90 && b.north === 90) || (a.south === -90 && b.south === -90)) return true;
  return arcHas(a.west, a.east, b.west) || arcHas(b.west, b.east, a.west);
}

/** This function gives the GeoJSON form `[west, south, east, north]` of a box. */
export function toGeoJsonBBox(box: BBox): GeoJsonBBox {
  return [box.west, box.south, box.east, box.north];
}

/**
 * This function reads a GeoJSON bounding box of 4 or 6 numbers, with the rules of `parseGeoJson`. It examines the
 * altitudes, and then it ignores them.
 *
 * @throws GeoError - The code is `bbox`, `not-finite`, `longitude-range` or `latitude-range`.
 */
export function fromGeoJsonBBox(bbox: readonly number[]): BBox {
  checkGeoJsonBBox(bbox, "");
  const half = bbox.length / 2;
  const box: BBox = {
    west: bbox[0] as number,
    south: bbox[1] as number,
    east: bbox[half] as number,
    north: bbox[half + 1] as number,
  };
  return box;
}
