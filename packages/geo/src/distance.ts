/**
 * This module gives the great-circle distance from a point to a GeoJSON geometry: a point, a line, a polygon or a
 * collection of them.
 *
 * The rules:
 *
 * - An edge is a straight line in longitude and latitude (RFC 7946, section 3.1), as in the polygon tests. The
 *   distance to an edge is the distance on the sphere to the nearest point of that line.
 * - The distance to a polygon is 0 when `locatePoint` does not give `outside`. Otherwise, it is the distance to the
 *   nearest edge of a ring, also of a hole.
 * - The distance is 0 only when the point is on the geometry. A point that is not on the geometry gets a distance of
 *   `Number.MIN_VALUE` or more. Thus a test `distance <= limit` with a limit of 0 agrees with `locatePoint`.
 * - The distance to a geometry with no position is `Infinity`.
 *
 * The method:
 *
 * - An exact test with the predicates of the polygon tests finds a point on the geometry.
 * - For another point, the function divides each edge into pieces of 1 degree or less. In each piece, it finds the
 *   nearest point with a bisection on the slope of the haversine function.
 * - A piece with two near points is possible only when the point is near the center of the curve of the piece. Then
 *   the two distances are almost equal, and the error is very small. The property tests compare the result with a
 *   dense sample of each edge.
 *
 * @packageDocumentation
 */

import { checkGeometry, type Geometry } from "./geojson.ts";
import { checkGeometryLongitudes, locateInRing, partOf, type Part, type PointLocation, type Rings } from "./planar.ts";
import { locateInParts } from "./polygon.ts";
import { checkPoint, normalizeLon, type LatLon, type Position } from "./point.ts";
import { checkRadius, EARTH_MEAN_RADIUS_KM, EARTH_MEAN_RADIUS_METERS } from "./sphere.ts";

const RADIANS = Math.PI / 180;

/** The largest change of latitude or of longitude in one piece of an edge, in degrees. */
const PIECE_DEGREES = 1;

/** The parts of a geometry, by kind. */
interface Shapes {
  readonly points: Position[];
  readonly lines: Part[];
  readonly polygons: Part[];
}

/** The point of view: the point from which the function measures, with its latitude and longitude in degrees. */
export interface Viewer {
  readonly lat: number;
  readonly lon: number;
  readonly cosLat: number;
}

const memberPath = (path: string, name: string): string => (path === "" ? name : `${path}.${name}`);

function addLine(line: readonly Position[], path: string, shapes: Shapes): void {
  checkGeometryLongitudes(line, path);
  if (line.length > 0) shapes.lines.push(partOf([line]));
}

function addPolygon(rings: Rings, path: string, shapes: Shapes): void {
  rings.forEach((ring, index) => checkGeometryLongitudes(ring, `${path}[${index}]`));
  if (rings.length > 0) shapes.polygons.push(partOf(rings));
}

/** This function puts the points, the lines and the polygons of a valid geometry into the shapes. */
function collect(geometry: Geometry, path: string, shapes: Shapes): void {
  const coordinates = memberPath(path, "coordinates");
  switch (geometry.type) {
    case "Point":
      shapes.points.push(geometry.coordinates);
      break;
    case "MultiPoint":
      shapes.points.push(...geometry.coordinates);
      break;
    case "LineString":
      addLine(geometry.coordinates, coordinates, shapes);
      break;
    case "MultiLineString":
      geometry.coordinates.forEach((line, index) => addLine(line, `${coordinates}[${index}]`, shapes));
      break;
    case "Polygon":
      addPolygon(geometry.coordinates, coordinates, shapes);
      break;
    case "MultiPolygon":
      geometry.coordinates.forEach((rings, index) => addPolygon(rings, `${coordinates}[${index}]`, shapes));
      break;
    case "GeometryCollection": {
      const geometries = memberPath(path, "geometries");
      geometry.geometries.forEach((member, index) => collect(member, `${geometries}[${index}]`, shapes));
      break;
    }
  }
}

/** The plane test of a line: a point on an edge is on the line. The line has no inside. */
function onLines(rings: Rings, x: number, y: number, dx: number = 0): PointLocation {
  return rings.some((line) => locateInRing(line, x, y, dx) === "boundary") ? "boundary" : "outside";
}

/** This function gives `true` when two positions are the same point of the sphere. The test has no rounding. */
function samePoint(point: LatLon, position: Position): boolean {
  const lat = position[1];
  if (lat !== point.lat) return false;
  return Math.abs(lat) === 90 || normalizeLon(position[0]) === normalizeLon(point.lon);
}

/** This function gives a longitude difference in degrees, moved by a multiple of 360 into the range -180 to 180. */
const reduceLon = (difference: number): number => difference - 360 * Math.round(difference / 360);

/**
 * This function gives the haversine value `sin²(Δφ/2) + cos φv cos φ sin²(Δλ/2)` of a point at the latitude `lat`. The
 * differences from the viewer are `dLat` and `dLon`, in degrees. The value increases with the central angle.
 */
function haversine(viewer: Viewer, lat: number, dLat: number, dLon: number): number {
  const a = Math.sin((dLat * RADIANS) / 2);
  const b = Math.sin((dLon * RADIANS) / 2);
  return a * a + viewer.cosLat * Math.cos(lat * RADIANS) * b * b;
}

/** This function gives the haversine value of a position of the geometry. */
function haversineOf(viewer: Viewer, position: Position): number {
  const lat = position[1];
  return haversine(viewer, lat, lat - viewer.lat, reduceLon(normalizeLon(position[0]) - viewer.lon));
}

/** This function gives the smallest haversine value for a latitude gap in degrees. */
function gapBound(gap: number): number {
  const a = Math.sin((gap * RADIANS) / 2);
  return a * a;
}

/** This function gives `true` when the position `b` comes before the position `a`, by longitude and then by latitude. */
const comesBefore = (b: Position, a: Position): boolean => b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]);

/**
 * This function gives the smallest haversine value from the viewer to the edge from `a` to `b`, or `best` when that is
 * smaller. A point of the edge is `(latA + u dLat, lonA + u dLon)`, with `u` from 0 to 1. The function measures each
 * edge from its first position by longitude and latitude. Thus the edge from `b` to `a` gives the same value.
 */
function edgeMinimum(viewer: Viewer, from: Position, to: Position, best: number): number {
  const [a, b] = comesBefore(to, from) ? [to, from] : [from, to];
  const latA = a[1];
  const latB = b[1];
  // The central angle is not less than the difference of the latitudes.
  const gap = Math.max(0, Math.min(latA, latB) - viewer.lat, viewer.lat - Math.max(latA, latB));
  if (gapBound(gap) >= best) return best;
  const dLat = latB - latA;
  const dLon = b[0] - a[0];
  const lat0 = latA - viewer.lat;
  const lon0 = reduceLon(a[0] - viewer.lon);
  const valueAt = (u: number): number => haversine(viewer, latA + u * dLat, lat0 + u * dLat, lon0 + u * dLon);
  // The sign of the derivative of the haversine value by u. The form has no cancellation near the viewer.
  const slopeAt = (u: number): number => {
    const phi = (latA + u * dLat) * RADIANS;
    const dPhi = (lat0 + u * dLat) * RADIANS;
    const dLambda = (lon0 + u * dLon) * RADIANS;
    const s = Math.sin(dLambda / 2);
    const cosLat = viewer.cosLat;
    return dLat * (Math.sin(dPhi) - 2 * cosLat * Math.sin(phi) * s * s) + dLon * cosLat * Math.cos(phi) * Math.sin(dLambda);
  };
  const pieces = Math.max(1, Math.ceil(Math.max(Math.abs(dLat), Math.abs(dLon)) / PIECE_DEGREES));
  let result = best;
  let u0 = 0;
  let slope0 = slopeAt(0);
  for (let index = 1; index <= pieces; index += 1) {
    const u1 = index / pieces;
    const slope1 = slopeAt(u1);
    result = Math.min(result, valueAt(u1));
    if (slope0 < 0 && slope1 > 0) {
      const lat1 = latA + u0 * dLat;
      const lat2 = latA + u1 * dLat;
      const pieceGap = Math.max(0, Math.min(lat1, lat2) - viewer.lat, viewer.lat - Math.max(lat1, lat2));
      if (gapBound(pieceGap) < result) {
        let low = u0;
        let high = u1;
        for (;;) {
          const middle = low + (high - low) / 2;
          if (middle <= low || middle >= high) break;
          if (slopeAt(middle) < 0) low = middle;
          else high = middle;
        }
        result = Math.min(result, valueAt(low), valueAt(high));
      }
    }
    u0 = u1;
    slope0 = slope1;
  }
  return result;
}

function ringsMinimum(viewer: Viewer, rings: Rings, best: number): number {
  let result = best;
  for (const ring of rings) {
    for (let index = 0; index + 1 < ring.length; index += 1) {
      result = edgeMinimum(viewer, ring[index] as Position, ring[index + 1] as Position, result);
    }
  }
  return result;
}

/** This function gives the central angle in radians for a haversine value. */
const angleOfHaversine = (value: number): number => 2 * Math.asin(Math.min(1, Math.sqrt(value)));

/**
 * This function gives the viewer at a valid position.
 *
 * @internal
 */
export function viewerAt(position: Position): Viewer {
  const lat = position[1];
  return { lat, lon: normalizeLon(position[0]), cosLat: Math.cos(lat * RADIANS) };
}

/**
 * This function gives the central angle in radians from the viewer to a position, with the method of
 * `distanceToGeometryKm`. It is not less than the angle from the viewer to an edge from that position.
 *
 * @internal
 */
export function angleToPosition(viewer: Viewer, position: Position): number {
  return angleOfHaversine(haversineOf(viewer, position));
}

/**
 * This function gives the central angle in radians from the viewer to the edge from `a` to `b`, with the method of
 * `distanceToGeometryKm`. The edge from `b` to `a` gives the same angle. The angle can be 0 for a viewer that is
 * very near the edge but not on it.
 *
 * @internal
 */
export function angleToEdge(viewer: Viewer, a: Position, b: Position): number {
  return angleOfHaversine(edgeMinimum(viewer, a, b, Math.min(haversineOf(viewer, a), haversineOf(viewer, b))));
}

/** This function gives the central angle from a valid point to the shapes, in radians. */
function angleToShapes(point: LatLon, shapes: Shapes): number {
  if (locateInParts(shapes.polygons, point) !== "outside") return 0;
  if (shapes.points.some((position) => samePoint(point, position))) return 0;
  if (locateInParts(shapes.lines, point, onLines) !== "outside") return 0;
  const viewer: Viewer = { lat: point.lat, lon: normalizeLon(point.lon), cosLat: Math.cos(point.lat * RADIANS) };
  let best = Number.POSITIVE_INFINITY;
  // The vertices first: they give a small bound, so the bound of the latitudes skips more edges.
  for (const position of shapes.points) best = Math.min(best, haversineOf(viewer, position));
  for (const part of [...shapes.lines, ...shapes.polygons]) {
    for (const ring of part.rings) for (const position of ring) best = Math.min(best, haversineOf(viewer, position));
  }
  for (const part of [...shapes.lines, ...shapes.polygons]) best = ringsMinimum(viewer, part.rings, best);
  if (best === Number.POSITIVE_INFINITY) return best;
  // The point is not on the geometry, so the angle is more than 0. A rounding can give 0 for a very near point.
  return Math.max(Number.MIN_VALUE, angleOfHaversine(best));
}

function angleToGeometry(point: LatLon, geometry: Geometry): number {
  checkPoint(point);
  checkGeometry(geometry);
  const shapes: Shapes = { points: [], lines: [], polygons: [] };
  collect(geometry, "", shapes);
  return angleToShapes(point, shapes);
}

/**
 * This function multiplies the angle by the radius. An angle that is more than 0 gives a distance that is more than 0.
 *
 * @internal
 */
export function scale(angle: number, radius: number): number {
  return angle === 0 ? 0 : Math.max(Number.MIN_VALUE, angle * radius);
}

/**
 * This function gives the great-circle distance in kilometres from a point to the nearest point of a GeoJSON geometry.
 * The rules are in the description of this module. The model is a sphere.
 *
 * - The distance to a polygon is 0 when the polygon contains the point.
 * - The distance is 0 only when the point is on the geometry.
 * - The distance to a geometry with no position is `Infinity`.
 *
 * @param radiusKm - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_KM`.
 * @throws GeoError - The codes of `locatePoint` and of `parseGeometry`, and `radius`.
 */
export function distanceToGeometryKm(point: LatLon, geometry: Geometry, radiusKm: number = EARTH_MEAN_RADIUS_KM): number {
  checkRadius(radiusKm);
  return scale(angleToGeometry(point, geometry), radiusKm);
}

/**
 * This function gives the great-circle distance in metres from a point to the nearest point of a GeoJSON geometry. It
 * uses the rules of `distanceToGeometryKm`.
 *
 * @param radiusMeters - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_METERS`.
 * @throws GeoError - As `distanceToGeometryKm`.
 */
export function distanceToGeometryMeters(
  point: LatLon,
  geometry: Geometry,
  radiusMeters: number = EARTH_MEAN_RADIUS_METERS,
): number {
  checkRadius(radiusMeters);
  return scale(angleToGeometry(point, geometry), radiusMeters);
}
