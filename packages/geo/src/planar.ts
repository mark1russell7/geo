/**
 * The planar core of the polygon tests. RFC 7946 (section 3.1) says that an edge is a straight line in longitude and
 * latitude. So these tests work on the plane of longitude and latitude. The orientation signs and the segment
 * relations come from the exact predicates of `@mark1russell7/predicates`.
 *
 * @internal
 * @packageDocumentation
 */

import { classifySegments, orient2dSign } from "@mark1russell7/predicates";
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
 * This function examines a Polygon or a MultiPolygon, and gives its polygons with their extents. A polygon with no ring
 * is not in the result.
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
  for (const rings of polygons) {
    if (rings.length === 0) continue;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const ring of rings) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    parts.push({ rings, minX, maxX, minY, maxY });
  }
  return parts;
}

const between = (value: number, a: number, b: number): boolean => (a <= b ? a <= value && value <= b : b <= value && value <= a);

/**
 * This function gives the location of a point against one ring, with the even-odd rule. The ring moves by `dx` on the
 * x axis. A point on an edge or on a vertex is on the boundary. The result is exact for the moved ring.
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

/** This function gives the location of a point against one polygon with holes, in the plane. The rings move by `dx`. */
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

/**
 * This function gives each shift `360 * k` that moves the value into the closed range from `min` to `max`.
 */
export function shiftsInto(value: number, min: number, max: number): readonly number[] {
  const shifts: number[] = [];
  const first = Math.ceil((min - value) / 360) - 1;
  const last = Math.floor((max - value) / 360) + 1;
  for (let k = first; k <= last; k += 1) {
    const moved = value + 360 * k;
    if (moved >= min && moved <= max) shifts.push(360 * k);
  }
  return shifts;
}

/**
 * This function gives each shift `360 * k` that makes the moved range `[minB + 360 k, maxB + 360 k]` meet the range
 * `[minA, maxA]`.
 */
export function overlappingShifts(minA: number, maxA: number, minB: number, maxB: number): readonly number[] {
  const shifts: number[] = [];
  const first = Math.ceil((minA - maxB) / 360) - 1;
  const last = Math.floor((maxA - minB) / 360) + 1;
  for (let k = first; k <= last; k += 1) {
    if (maxB + 360 * k >= minA && minB + 360 * k <= maxA) shifts.push(360 * k);
  }
  return shifts;
}

/**
 * This function gives `true` when an edge of the rings `a` and an edge of the rings `b` have a common point. The rings
 * `b` move by `dx`.
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
 * moves by `dx`.
 *
 * When no edge of `a` meets an edge of `b`, each boundary is fully inside or fully outside the other polygon. Then the
 * polygons meet only when a vertex of one exterior is in the other polygon.
 */
export function partsMeet(a: Part, b: Part, dx: number): boolean {
  if (a.maxX < b.minX + dx || a.minX > b.maxX + dx || a.maxY < b.minY || a.minY > b.maxY) return false;
  if (edgesMeet(a, b, dx)) return true;
  const vertexA = a.rings[0]?.[0];
  if (vertexA !== undefined && locateInRings(b.rings, vertexA[0], vertexA[1], dx) !== "outside") return true;
  const vertexB = b.rings[0]?.[0];
  return vertexB !== undefined && locateInRings(a.rings, vertexB[0] + dx, vertexB[1]) !== "outside";
}
