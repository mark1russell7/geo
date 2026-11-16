/**
 * Bounding boxes on the Earth. A box can cross the antimeridian: then its west is more than its east.
 *
 * @packageDocumentation
 */

import { dyadic } from "@mark1russell7/predicates";
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
    // The two ends of the arc have no rounding. So two edges with a common position give two arcs that touch.
    const arc = boxLongitudes(start, end);
    // The sum with 0 makes -0 into 0, as `normalizeLon` does.
    const west = arc[0] + 0;
    const east = arc[1] + 0;
    if (west === 180) {
      // The arc is only the antimeridian. The longitude 180 is the longitude -180.
      this.intervals.push([-180, -180]);
    } else if (west <= east) {
      this.intervals.push([west, east]);
    } else {
      this.intervals.push([west, 180], [-180, east]);
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

/**
 * This function gives the middle of a box. Its latitude is the middle of the latitudes of the box. Its longitude is the
 * middle of the arc of longitudes from the west to the east. For a box that crosses the antimeridian, the middle is on
 * the arc across the antimeridian.
 *
 * - The closed box has the result: `bboxContains(box, bboxCenter(box))` is `true`.
 * - The longitude of the result is from -180 to 180. A box of the full circle, from -180 to 180, gives the longitude 0.
 * - The middle is a place for a label or for the first view of a map. It is not the centroid of a shape in the box.
 *
 * @throws GeoError - The code is `not-finite`, `longitude-range`, `latitude-range` or `bbox`.
 */
export function bboxCenter(box: BBox): LatLon {
  checkBBox(box);
  // The sum of a value and a half of a difference stays between the two ends. A half of the sum can round out of them.
  const lat = box.south + (box.north - box.south) / 2;
  if (box.west <= box.east) return { lat, lon: box.west + (box.east - box.west) / 2 };
  const lon = normalizeLon(box.west + (box.east + 360 - box.west) / 2);
  // The width across the antimeridian has two roundings. A result out of the arc by one rounding step goes to the west end.
  return { lat, lon: arcHas(box.west, box.east, lon) ? lon : box.west };
}

/** This function gives the GeoJSON form `[west, south, east, north]` of a box. */
export function toGeoJsonBBox(box: BBox): GeoJsonBBox {
  return [box.west, box.south, box.east, box.north];
}

const inLonRange = (lon: number): boolean => lon >= -180 && lon <= 180;

/**
 * This function gives the west and the east of a GeoJSON box, from -180 to 180, with no rounding. The box is the arc
 * from the west to the east in the direction of the east.
 */
function boxLongitudes(west: number, east: number): readonly [west: number, east: number] {
  if (inLonRange(west) && inLonRange(east)) return [west, east];
  // The test of the width has no rounding. In floating point, `east - west` can round up to 360.
  if (dyadic.compare(dyadic.sub(dyadic.fromFloat(east), dyadic.fromFloat(west)), dyadic.fromFloat(360)) >= 0) {
    return [-180, 180];
  }
  const start = normalizeLon(west);
  const end = normalizeLon(east);
  // An east on the antimeridian ends the arc at 180. When the west is on the antimeridian too, the arc has no width.
  return [start, end === -180 && start !== -180 ? 180 : end];
}

/**
 * This function reads a GeoJSON bounding box of 4 or 6 numbers, with the rules of `parseGeoJson`. It examines the
 * altitudes, and then it ignores them. It gives a box with longitudes from -180 to 180, with no rounding:
 *
 * - A box with its two longitudes from -180 to 180 does not change. This is the form of RFC 7946, section 5.2.
 * - A box with `east - west` of 360 or more has the full range of longitudes, from -180 to 180.
 * - For each other box, the west is `normalizeLon(west)`, and the east is `normalizeLon(east)`.
 * - In that last rule, an east that is 180 plus a multiple of 360 becomes 180. If the west is also on that meridian,
 *   the east stays -180, and the box is only the antimeridian.
 *
 * So `[190, 540]` gives the box of `[-170, 180]`, and `[170, 190]` gives `[170, -170]`, a box that crosses the
 * antimeridian.
 *
 * @throws GeoError - The code is `bbox`, `not-finite` or `latitude-range`.
 */
export function fromGeoJsonBBox(bbox: readonly number[]): BBox {
  checkGeoJsonBBox(bbox, "");
  const half = bbox.length / 2;
  const [west, east] = boxLongitudes(bbox[0] as number, bbox[half] as number);
  return { west, south: bbox[1] as number, east, north: bbox[half + 1] as number };
}
