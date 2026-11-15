/**
 * The planar core of the polygon tests. RFC 7946 (section 3.1) says that an edge is a straight line in longitude and
 * latitude. So these tests work on the plane of longitude and latitude. The orientation signs and the segment
 * relations come from the exact predicates of `@mark1russell7/predicates`.
 *
 * @internal
 * @packageDocumentation
 */

import { classifySegments, dyadic, orient2dSign } from "@mark1russell7/predicates";
import { GeoError } from "./errors.ts";
import { checkPolygonCoordinates, type MultiPolygon, type Polygon } from "./geojson.ts";
import type { Position } from "./point.ts";

/** The location of a point against a closed polygon. */
export type PointLocation = "inside" | "boundary" | "outside";

/** A ring: closed positions. */
export type Ring = readonly Position[];

/** The rings of one polygon: the exterior first, then the holes. */
export type Rings = readonly Ring[];

/** The extent of the rings of one polygon in the plane. */
export interface Part {
  readonly rings: Rings;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/**
 * The largest absolute longitude of a position that the polygon tests accept: 540 degrees, one turn past the
 * antimeridian on each side.
 *
 * - The work of a test is in proportion to the width of the longitudes over 360. This limit keeps it small.
 * - The limits of the exact results in the README are for this range only.
 * - Each part of the Earth has a form in this range, so the limit refuses no area.
 */
export const MAX_GEOMETRY_LONGITUDE = 540;

/**
 * This function refuses a position with a longitude out of the range of `MAX_GEOMETRY_LONGITUDE`. The function gets
 * only a valid GeoJSON position.
 */
export function checkGeometryLongitude(position: Position, path: string): void {
  const lon = position[0];
  if (lon < -MAX_GEOMETRY_LONGITUDE || lon > MAX_GEOMETRY_LONGITUDE) {
    throw new GeoError(
      "longitude-range",
      `The longitude ${lon} is not from -${MAX_GEOMETRY_LONGITUDE} to ${MAX_GEOMETRY_LONGITUDE}`,
      path,
    );
  }
}

/**
 * This function examines a Polygon or a MultiPolygon, and gives its polygons with their extents. A polygon with no ring
 * is not in the result. A longitude out of the range of `MAX_GEOMETRY_LONGITUDE` gives the error `longitude-range`.
 */
export function polygonParts(geometry: Polygon | MultiPolygon): readonly Part[] {
  let polygons: readonly Rings[];
  if (geometry.type === "Polygon") {
    checkPolygonCoordinates(geometry.coordinates, "coordinates");
    polygons = [geometry.coordinates];
  } else if (geometry.type === "MultiPolygon") {
    if (!Array.isArray(geometry.coordinates)) throw new GeoError("geojson-member", "The value must be an array", "coordinates");
    geometry.coordinates.forEach((polygon, index) => checkPolygonCoordinates(polygon, `coordinates[${index}]`));
    polygons = geometry.coordinates;
  } else {
    throw new GeoError("geojson-type", "The geometry must be a Polygon or a MultiPolygon");
  }
  const parts: Part[] = [];
  polygons.forEach((rings, polygonIndex) => {
    if (rings.length === 0) return;
    const path = geometry.type === "Polygon" ? "coordinates" : `coordinates[${polygonIndex}]`;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    rings.forEach((ring, ringIndex) => {
      ring.forEach((position, positionIndex) => {
        checkGeometryLongitude(position, `${path}[${ringIndex}][${positionIndex}]`);
        const [x, y] = position;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
    });
    parts.push({ rings, minX, maxX, minY, maxY });
  });
  return parts;
}

const between = (value: number, a: number, b: number): boolean => (a <= b ? a <= value && value <= b : b <= value && value <= a);

/**
 * This function gives the location of a point against one ring, with the even-odd rule. The ring moves by `dx` on the
 * x axis. A point on an edge or on a vertex is on the boundary. The result is exact for the ring after the move in
 * floating point. That ring is the written ring moved by `dx` when `movesExactly` holds for each vertex.
 *
 * @internal This function moves to `@mark1russell7/predicates`, the home of exact predicates, with the offset
 *   orientation. Then geo imports it.
 */
export function locateInRing(ring: Ring, x: number, y: number, dx: number = 0): PointLocation {
  let inside = false;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const a = ring[index] as Position;
    const b = ring[index + 1] as Position;
    const ax = a[0] + dx;
    const ay = a[1];
    const bx = b[0] + dx;
    const by = b[1];
    // The half-open rule: an edge crosses the ray when one end is at or below y and the other end is above y.
    const crosses = ay <= y !== by <= y;
    const inBox = between(x, ax, bx) && between(y, ay, by);
    if (!crosses && !inBox) continue;
    const sign = orient2dSign(ax, ay, bx, by, x, y);
    // A crossing edge is not horizontal. So a point on its line at the height y is in its box, and it is on the edge.
    if (sign === 0) return "boundary";
    // The ray goes to the east. An upward edge is east of the point when the point is on its left side.
    if (crosses && (ay <= y ? sign > 0 : sign < 0)) inside = !inside;
  }
  return inside ? "inside" : "outside";
}

/**
 * This function gives the location of a point against one polygon with holes, in the plane. The rings move by `dx`.
 *
 * @internal This function moves to `@mark1russell7/predicates`, the home of exact predicates, with the offset
 *   orientation. Then geo imports it.
 */
export function locateInRings(rings: Rings, x: number, y: number, dx: number = 0): PointLocation {
  const exterior = rings[0];
  if (exterior === undefined) return "outside";
  const where = locateInRing(exterior, x, y, dx);
  if (where !== "inside") return where;
  for (let index = 1; index < rings.length; index += 1) {
    const hole = locateInRing(rings[index] as Ring, x, y, dx);
    if (hole === "boundary") return "boundary";
    if (hole === "inside") return "outside";
  }
  return "inside";
}

/** This function gives `true` when a ring of the polygon has a position at the latitude. */
export function touchesLatitude(rings: Rings, lat: number): boolean {
  return rings.some((ring) => ring.some((position) => position[1] === lat));
}

/** It gives the sign of `x + shift - bound` with no rounding. */
function compareSum(x: number, shift: number, bound: number): -1 | 0 | 1 {
  return dyadic.compare(dyadic.add(dyadic.fromFloat(x), dyadic.fromFloat(shift)), dyadic.fromFloat(bound));
}

/**
 * This function gives each shift `360 * k` that moves the value into the closed range from `min` to `max`. The test
 * of the range has no rounding.
 */
export function shiftsInto(value: number, min: number, max: number): readonly number[] {
  const shifts: number[] = [];
  const first = Math.ceil((min - value) / 360) - 1;
  const last = Math.floor((max - value) / 360) + 1;
  for (let k = first; k <= last; k += 1) {
    const shift = 360 * k;
    if (compareSum(value, shift, min) >= 0 && compareSum(value, shift, max) <= 0) shifts.push(shift);
  }
  return shifts;
}

/**
 * This function gives each shift `360 * k` that makes the moved range `[minB + 360 k, maxB + 360 k]` meet the range
 * `[minA, maxA]`. The test of the ranges has no rounding. So the shifts of `b` against `a` are the negatives of the
 * shifts of `a` against `b`.
 */
export function overlappingShifts(minA: number, maxA: number, minB: number, maxB: number): readonly number[] {
  const shifts: number[] = [];
  const first = Math.ceil((minA - maxB) / 360) - 1;
  const last = Math.floor((maxA - minB) / 360) + 1;
  for (let k = first; k <= last; k += 1) {
    const shift = 360 * k;
    if (compareSum(maxB, shift, minA) >= 0 && compareSum(minB, shift, maxA) <= 0) shifts.push(shift);
  }
  return shifts;
}

/**
 * This function gives `true` when a rule proves that the floating-point sum `x + shift` has no rounding. The shift is
 * a multiple of 360. The rule holds when the shift is 0. It also holds when these three conditions are true:
 *
 * - The shift and `x` have opposite signs.
 * - `|x|` is less than 2^56.
 * - `|x|` is not less than the smallest power of 2 that is more than a third of `|shift|`.
 *
 * For a shift of 360 or -360, that power is 128. For a shift of 720 or -720, it is 256. The rule does not find each
 * exact sum.
 */
export function movesExactly(x: number, shift: number): boolean {
  if (shift === 0) return true;
  if (x === 0 || (x < 0) === (shift < 0)) return false;
  const size = Math.abs(x);
  if (size >= 2 ** 56) return false;
  // The proof: let 2^e <= |x| < 2^(e + 1). The rule gives |shift| < 3 * 2^e. The two numbers are multiples of
  // 2^(e - 52), because 360 is a multiple of 8 and e <= 55. The signs are opposite, so |x + shift| < 2^(e + 1). A
  // multiple of 2^(e - 52) below 2^(e + 1) has 53 bits or fewer, so it is a double, and the sum has no rounding.
  let power = 1;
  while (power * 3 <= Math.abs(shift) && power <= size) power *= 2;
  return size >= power;
}

/**
 * This function gives `true` when `movesExactly` holds for each vertex of the part. Then the move of the part by the
 * shift has no rounding.
 */
export function partMovesExactly(part: Part, shift: number): boolean {
  // For one shift, the values that move exactly make one interval. So the two ends of the part decide for each vertex.
  return movesExactly(part.minX, shift) && movesExactly(part.maxX, shift);
}

/**
 * This function gives `true` when an edge of the rings `a` and an edge of the rings `b` have a common point. The rings
 * `b` move by `dx`.
 *
 * @internal This function moves to `@mark1russell7/predicates`, the home of exact predicates, with the offset
 *   orientation. Then geo imports it.
 */
function edgesMeet(a: Part, b: Part, dx: number): boolean {
  const bMinX = b.minX + dx;
  const bMaxX = b.maxX + dx;
  for (const ringA of a.rings) {
    for (let i = 0; i + 1 < ringA.length; i += 1) {
      const p = ringA[i] as Position;
      const q = ringA[i + 1] as Position;
      const pMinX = Math.min(p[0], q[0]);
      const pMaxX = Math.max(p[0], q[0]);
      const pMinY = Math.min(p[1], q[1]);
      const pMaxY = Math.max(p[1], q[1]);
      if (pMaxX < bMinX || pMinX > bMaxX || pMaxY < b.minY || pMinY > b.maxY) continue;
      for (const ringB of b.rings) {
        for (let j = 0; j + 1 < ringB.length; j += 1) {
          const r = ringB[j] as Position;
          const s = ringB[j + 1] as Position;
          const rx = r[0] + dx;
          const sx = s[0] + dx;
          if (Math.max(rx, sx) < pMinX || Math.min(rx, sx) > pMaxX) continue;
          if (Math.max(r[1], s[1]) < pMinY || Math.min(r[1], s[1]) > pMaxY) continue;
          if (classifySegments(p[0], p[1], q[0], q[1], rx, r[1], sx, s[1]).relation !== "disjoint") return true;
        }
      }
    }
  }
  return false;
}

/**
 * This function gives `true` when two closed polygons with holes have a common point in the plane. The polygon `b`
 * moves by `dx`. The result is exact when `partMovesExactly(b, dx)` holds.
 *
 * When no edge of `a` meets an edge of `b`, each boundary is fully inside or fully outside the other polygon. Then the
 * polygons meet only when a vertex of one exterior is in the other polygon.
 *
 * @internal This function moves to `@mark1russell7/predicates`, the home of exact predicates, with the offset
 *   orientation. Then geo imports it.
 */
export function partsMeet(a: Part, b: Part, dx: number): boolean {
  if (a.maxX < b.minX + dx || a.minX > b.maxX + dx || a.maxY < b.minY || a.minY > b.maxY) return false;
  if (edgesMeet(a, b, dx)) return true;
  const vertexA = a.rings[0]?.[0];
  if (vertexA !== undefined && locateInRings(b.rings, vertexA[0], vertexA[1], dx) !== "outside") return true;
  const vertexB = b.rings[0]?.[0];
  return vertexB !== undefined && locateInRings(a.rings, vertexB[0] + dx, vertexB[1]) !== "outside";
}
