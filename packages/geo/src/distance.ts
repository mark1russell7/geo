/**
 * This module gives the great-circle distance from a point to a GeoJSON geometry, and between two GeoJSON geometries.
 * A geometry is a point, a line, a polygon or a collection of them.
 *
 * The rules of the distance from a point:
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
 * The rules of the distance between two geometries:
 *
 * - The distance is 0 when the geometries share a point. Then two edges meet, or a position of one geometry is on the
 *   other geometry or in its polygon. The test is exact.
 * - Otherwise, the distance is the smallest distance from a position of one geometry to the other geometry, in the two
 *   directions. Each distance from a position uses the method above.
 * - The result does not change when the two geometries change places.
 * - The distance to a geometry with no position is `Infinity`.
 *
 * Why the positions are sufficient:
 *
 * - Two edges that do not meet have a nearest pair of points with an end of one edge in it. Then the nearest pair of
 *   two geometries that do not share a point has a position of one geometry in it.
 * - This statement has no proof at this time. It is a result of a study of 1,600 random pairs of edges: no pair had
 *   its nearest points inside the two edges. A property test compares the result with a dense sample of two edges in
 *   each CI run.
 *
 * The cost: the function examines each position of one geometry against each part of the other geometry. A bound of
 * the latitudes skips each part and each edge that is too far. So the time is in proportion to the product of the
 * numbers of positions in the worst case. An index of the edges replaces this method when a consumer needs large
 * inputs.
 *
 * @packageDocumentation
 */

import { checkGeometry, type Geometry } from "./geojson.ts";
import {
  checkGeometryLongitudes,
  edgesMeet,
  onLine,
  overlappingShifts,
  partOf,
  type Part,
  type Ring,
  type Rings,
} from "./planar.ts";
import { inRings, locateInParts, type PlaneTest } from "./polygon.ts";
import { checkPoint, normalizeLon, type LatLon, type Position } from "./point.ts";
import { checkRadius, EARTH_MEAN_RADIUS_KM, EARTH_MEAN_RADIUS_METERS } from "./sphere.ts";

const RADIANS = Math.PI / 180;

/** The largest change of latitude or of longitude in one piece of an edge, in degrees. */
const PIECE_DEGREES = 1;

/** The count of rounds of split points near the root of the slope, before the halving of a bracket. */
const SPLIT_ROUNDS = 4;

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
const onLines: PlaneTest = (part, x, y, dx) => (part.rings.some((line) => onLine(line, x, y, dx)) ? "boundary" : "outside");

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

/** This function gives the latitude gap from the viewer to the edge from `a` to `b`, in degrees, or 0. */
const gapOf = (viewer: Viewer, a: Position, b: Position): number =>
  Math.max(0, Math.min(a[1], b[1]) - viewer.lat, viewer.lat - Math.max(a[1], b[1]));

/**
 * This function gives the haversine value at one point of the edge from `a` to `b`. That point is the nearest point to
 * the viewer in a local plane. In that plane, a longitude difference counts with the cosine of the latitude of the
 * viewer. Thus the value is near the smallest value of the edge, and it is not less than it.
 */
function probeValue(viewer: Viewer, a: Position, b: Position): number {
  const latA = a[1];
  const dLat = b[1] - latA;
  const dLon = b[0] - a[0];
  const lat0 = latA - viewer.lat;
  const lon0 = reduceLon(a[0] - viewer.lon);
  const scale = viewer.cosLat * viewer.cosLat;
  const length = dLat * dLat + scale * dLon * dLon;
  const u = length > 0 ? Math.min(1, Math.max(0, -(lat0 * dLat + scale * lon0 * dLon) / length)) : 0;
  return haversine(viewer, latA + u * dLat, lat0 + u * dLat, lon0 + u * dLon);
}

/**
 * This function gives the smallest haversine value from the viewer to the edge from `a` to `b`, or `best` when that is
 * smaller. A point of the edge is `(latA + u dLat, lonA + u dLon)`, with `u` from 0 to 1. The function measures each
 * edge from its first position by longitude and latitude. Thus the edge from `b` to `a` gives the same value.
 *
 * The result is not more than `edgeBound` of the edge, for each `best`.
 */
function edgeMinimum(viewer: Viewer, from: Position, to: Position, best: number): number {
  const swap = comesBefore(to, from);
  const a = swap ? to : from;
  const b = swap ? from : to;
  // The central angle is not less than the difference of the latitudes.
  if (gapBound(gapOf(viewer, a, b)) >= best) return best;
  const latA = a[1];
  const dLat = b[1] - latA;
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
  // The probe makes the result not more than the bound. A small result also skips more pieces.
  let result = Math.min(best, probeValue(viewer, a, b));
  const pieces = Math.max(1, Math.ceil(Math.max(Math.abs(dLat), Math.abs(dLon)) / PIECE_DEGREES));
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
        // Each split keeps the slope less than 0 at `low` and not less than 0 at `high`, and the bisection ends at two
        // adjacent doubles. When the sign of the slope changes one time, each order of splits gives the same two doubles.
        let low = u0;
        let high = u1;
        let slopeLow = slope0;
        let slopeHigh = slope1;
        // The split points near the root of the slope make the bracket small with few steps.
        for (let round = 0; round < SPLIT_ROUNDS; round += 1) {
          const root = low + (high - low) * (slopeLow / (slopeLow - slopeHigh));
          if (!(root > low && root < high)) break;
          const slope = slopeAt(root);
          if (slope < 0) {
            low = root;
            slopeLow = slope;
          } else {
            high = root;
            slopeHigh = slope;
          }
          // A second split past the root, on the other side, closes the bracket from that side.
          const next = low + (high - low) * (slopeLow / (slopeLow - slopeHigh));
          const reach = 2 * Math.abs(next - root);
          const other = slope < 0 ? next + reach : next - reach;
          if (!(other > low && other < high)) continue;
          const otherSlope = slopeAt(other);
          if (otherSlope < 0) {
            low = other;
            slopeLow = otherSlope;
          } else {
            high = other;
            slopeHigh = otherSlope;
          }
        }
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

/**
 * This function gives a haversine value that is not less than the result of `edgeMinimum` for the edge, for each
 * `best`. It measures one point of the edge, so it is fast.
 */
function edgeBound(viewer: Viewer, from: Position, to: Position): number {
  const swap = comesBefore(to, from);
  const a = swap ? to : from;
  const b = swap ? from : to;
  const gap = gapOf(viewer, a, b);
  const value = probeValue(viewer, a, b);
  return gap > 0 ? Math.max(gapBound(gap), value) : value;
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
 * This function gives the central angle in radians from the viewer to the edge from `a` to `b`, with the method of
 * `distanceToGeometryKm`. The edge from `b` to `a` gives the same angle. The angle can be 0 for a viewer that is
 * very near the edge but not on it.
 *
 * @internal
 */
export function angleToEdge(viewer: Viewer, a: Position, b: Position): number {
  return angleOfHaversine(edgeMinimum(viewer, a, b, Math.min(haversineOf(viewer, a), haversineOf(viewer, b))));
}

/**
 * This function gives an angle in radians that is not less than `angleToEdge(viewer, a, b)`. It measures one point of
 * the edge, so it is fast. A scan skips each edge whose bound is not more than its best angle.
 *
 * @internal
 */
export function angleBoundToEdge(viewer: Viewer, a: Position, b: Position): number {
  // The factor is more than the rounding of `Math.asin`, so a larger haversine value does not give a smaller angle.
  return angleOfHaversine(edgeBound(viewer, a, b)) * (1 + 2 ** -40);
}

/** This function gives `true` when a valid point is on the shapes or in a polygon of the shapes. The test is exact. */
function onShapes(point: LatLon, shapes: Shapes): boolean {
  if (locateInParts(shapes.polygons, point, inRings) !== "outside") return true;
  if (shapes.points.some((position) => samePoint(point, position))) return true;
  return locateInParts(shapes.lines, point, onLines) !== "outside";
}

/** This function gives the latitude gap from the viewer to the extent of a part, in degrees, or 0. */
const partGap = (viewer: Viewer, part: Part): number => Math.max(0, part.minY - viewer.lat, viewer.lat - part.maxY);

/**
 * This function gives the smallest haversine value from the viewer to a position or an edge of the shapes, or `best`
 * when that is smaller. The bound of the latitudes skips each part that cannot give a smaller value.
 */
function shapesMinimum(viewer: Viewer, shapes: Shapes, best: number): number {
  let result = best;
  const parts = [...shapes.lines, ...shapes.polygons];
  // The vertices first: they give a small bound, so the bound of the latitudes skips more parts and edges.
  for (const position of shapes.points) result = Math.min(result, haversineOf(viewer, position));
  for (const part of parts) {
    if (gapBound(partGap(viewer, part)) >= result) continue;
    for (const ring of part.rings) for (const position of ring) result = Math.min(result, haversineOf(viewer, position));
  }
  for (const part of parts) {
    if (gapBound(partGap(viewer, part)) < result) result = ringsMinimum(viewer, part.rings, result);
  }
  return result;
}

/**
 * This function gives the central angle in radians for the haversine value of shapes that do not share a point. The
 * angle is more than 0, or `Infinity` when the shapes have no position.
 */
function angleApart(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return value;
  // The shapes do not share a point, so the angle is more than 0. A rounding can give 0 for very near shapes.
  return Math.max(Number.MIN_VALUE, angleOfHaversine(value));
}

/** This function gives the central angle from a valid point to the shapes, in radians. */
function angleToShapes(point: LatLon, shapes: Shapes): number {
  if (onShapes(point, shapes)) return 0;
  return angleApart(shapesMinimum(viewerAt([point.lon, point.lat]), shapes, Number.POSITIVE_INFINITY));
}

/** This function examines a geometry and gives its shapes. The path of an error starts with `path`. */
function shapesOf(geometry: Geometry, path: string): Shapes {
  checkGeometry(geometry, path);
  const shapes: Shapes = { points: [], lines: [], polygons: [] };
  collect(geometry, path, shapes);
  return shapes;
}

function angleToGeometry(point: LatLon, geometry: Geometry): number {
  checkPoint(point);
  return angleToShapes(point, shapesOf(geometry, ""));
}

/**
 * This function gives `true` when an edge of one part meets an edge of the other part, or when the two parts touch
 * one pole. The part `b` moves by each multiple of 360 that makes the extents meet. The test is exact.
 */
function partEdgesMeet(a: Part, b: Part): boolean {
  if (a.maxY < b.minY || b.maxY < a.minY) return false;
  // All the longitudes of a pole are one point.
  if ((a.maxY === 90 && b.maxY === 90) || (a.minY === -90 && b.minY === -90)) return true;
  return overlappingShifts(a.minX, a.maxX, b.minX, b.maxX).some((shift) => edgesMeet(a, b, shift));
}

/**
 * This function gives `true` when a position of `from` is on `to` or in a polygon of `to`. The positions are the
 * points, and the first position of each part. The first position of a polygon is on its exterior, so it is a point of
 * the polygon.
 */
function firstPositionsOn(from: Shapes, to: Shapes): boolean {
  const on = (position: Position): boolean => onShapes({ lat: position[1], lon: position[0] }, to);
  return from.points.some(on) || [...from.lines, ...from.polygons].some((part) => on((part.rings[0] as Ring)[0] as Position));
}

/**
 * This function gives `true` when the shapes share a point. The test is exact.
 *
 * When no edge of `a` meets an edge of `b`, each line and each ring is fully inside or fully outside the other shapes.
 * Then one position of each line and of each exterior decides.
 */
function sharePoint(a: Shapes, b: Shapes): boolean {
  const partsB = [...b.lines, ...b.polygons];
  if ([...a.lines, ...a.polygons].some((partA) => partsB.some((partB) => partEdgesMeet(partA, partB)))) return true;
  return firstPositionsOn(a, b) || firstPositionsOn(b, a);
}

/** This function gives the smallest haversine value from a position of `from` to the shapes `to`. */
function nearestFrom(from: Shapes, to: Shapes): number {
  let best = Number.POSITIVE_INFINITY;
  for (const position of from.points) best = shapesMinimum(viewerAt(position), to, best);
  for (const part of [...from.lines, ...from.polygons]) {
    for (const ring of part.rings) for (const position of ring) best = shapesMinimum(viewerAt(position), to, best);
  }
  return best;
}

function angleBetweenGeometries(a: Geometry, b: Geometry): number {
  const shapesA = shapesOf(a, "a");
  const shapesB = shapesOf(b, "b");
  if (sharePoint(shapesA, shapesB)) return 0;
  // The two directions are separate, and the minimum of two values does not depend on their order.
  return angleApart(Math.min(nearestFrom(shapesA, shapesB), nearestFrom(shapesB, shapesA)));
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

/**
 * This function gives the great-circle distance in kilometres between the nearest points of two GeoJSON geometries.
 * The rules are in the description of this module. The model is a sphere.
 *
 * - The distance is 0 when the geometries share a point. A polygon in a hole of the other polygon does not share a
 *   point with it, unless they touch.
 * - The distance is 0 only when the geometries share a point.
 * - The result does not change when `a` and `b` change places.
 * - The distance to a geometry with no position is `Infinity`.
 *
 * The function measures from the positions only. A study of 1,600 pairs of edges supports this method, but it has no
 * proof at this time. A property test with a dense sample holds it in each CI run.
 *
 * The time is in proportion to the product of the numbers of positions in the worst case. For large geometries, an
 * index of the edges is the next step.
 *
 * @param radiusKm - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_KM`.
 * @throws GeoError - As `distanceToGeometryKm`. The path of an error starts with `a` or `b`, for the geometry of the
 *   error.
 */
export function distanceBetweenGeometriesKm(a: Geometry, b: Geometry, radiusKm: number = EARTH_MEAN_RADIUS_KM): number {
  checkRadius(radiusKm);
  return scale(angleBetweenGeometries(a, b), radiusKm);
}

/**
 * This function gives the great-circle distance in metres between the nearest points of two GeoJSON geometries. It
 * uses the rules of `distanceBetweenGeometriesKm`.
 *
 * @param radiusMeters - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_METERS`.
 * @throws GeoError - As `distanceBetweenGeometriesKm`.
 */
export function distanceBetweenGeometriesMeters(
  a: Geometry,
  b: Geometry,
  radiusMeters: number = EARTH_MEAN_RADIUS_METERS,
): number {
  checkRadius(radiusMeters);
  return scale(angleBetweenGeometries(a, b), radiusMeters);
}
