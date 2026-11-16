/**
 * The planar core of the polygon tests. RFC 7946 (section 3.1) says that an edge is a straight line in longitude and
 * latitude. So these tests work on the plane of longitude and latitude. The orientation signs and the segment
 * relations come from the exact predicates of `@mark1russell7/predicates`. A move by a multiple of 360 degrees uses the
 * shifted forms of these predicates, so the move has no rounding.
 *
 * @internal
 * @packageDocumentation
 */

import { classifySegmentsShifted, compareShifted, locateInRings as locateInRing, orient2dShiftedSign } from "@mark1russell7/predicates";
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
 * This function refuses each position with a longitude out of the range of `MAX_GEOMETRY_LONGITUDE`. The positions are
 * valid GeoJSON already. The path of the error is the path of the position.
 */
export function checkGeometryLongitudes(positions: readonly Position[], path: string): void {
  positions.forEach((position, index) => {
    const lon = position[0];
    if (lon < -MAX_GEOMETRY_LONGITUDE || lon > MAX_GEOMETRY_LONGITUDE) {
      throw new GeoError(
        "longitude-range",
        `The longitude ${lon} is not from -${MAX_GEOMETRY_LONGITUDE} to ${MAX_GEOMETRY_LONGITUDE}`,
        `${path}[${index}]`,
      );
    }
  });
}

/** This function gives the rings with their extent in the plane. The rings have one or more positions. */
export function partOf(rings: Rings): Part {
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
  return { rings, minX, maxX, minY, maxY };
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
    const path = geometry.type === "Polygon" ? "coordinates" : `coordinates[${polygonIndex}]`;
    rings.forEach((ring, ringIndex) => checkGeometryLongitudes(ring, `${path}[${ringIndex}]`));
    if (rings.length > 0) parts.push(partOf(rings));
  });
  return parts;
}

const between = (value: number, a: number, b: number): boolean => (a <= b ? a <= value && value <= b : b <= value && value <= a);

/**
 * This function gives `true` when the value `x` is in the range from `a + dx` to `b + dx`, in either order. The test
 * has no rounding.
 */
function betweenMoved(x: number, a: number, b: number, dx: number): boolean {
  return compareShifted(Math.min(a, b), dx, x) <= 0 && compareShifted(Math.max(a, b), dx, x) >= 0;
}

/**
 * This function gives `true` when the point is on an edge of the line moved by `dx` on the x axis. The line does not
 * close. A point in the box of an edge and on its line is on the edge. The test has no rounding.
 */
export function onLine(line: Ring, x: number, y: number, dx: number = 0): boolean {
  const back = 0 - dx;
  for (let index = 0; index + 1 < line.length; index += 1) {
    const a = line[index] as Position;
    const b = line[index + 1] as Position;
    if (between(y, a[1], b[1]) && betweenMoved(x, a[0], b[0], dx) && orient2dShiftedSign(a[0], a[1], b[0], b[1], x, y, back, 0) === 0) return true;
  }
  return false;
}

/**
 * This function gives the location of a point against one polygon with holes, in the plane. The rings move by `dx`,
 * with no rounding. The first ring is the exterior, and the next rings are holes, as in GeoJSON. A point in a hole is
 * outside, and a point on the edge of a hole is on the boundary.
 *
 * @internal Each ring test is `locateInRings` of `@mark1russell7/predicates`. This function adds the rule of holes.
 */
export function locateInRings(rings: Rings, x: number, y: number, dx: number = 0): PointLocation {
  const exterior = rings[0];
  if (exterior === undefined) return "outside";
  const where = locateInRing([exterior], x, y, dx);
  if (where !== "inside") return where;
  for (let index = 1; index < rings.length; index += 1) {
    const hole = locateInRing([rings[index] as Ring], x, y, dx);
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
 * This function gives each shift `360 * k` that moves the value into the closed range from `min` to `max`. The test
 * of the range has no rounding.
 */
export function shiftsInto(value: number, min: number, max: number): readonly number[] {
  const shifts: number[] = [];
  const first = Math.ceil((min - value) / 360) - 1;
  const last = Math.floor((max - value) / 360) + 1;
  for (let k = first; k <= last; k += 1) {
    const shift = 360 * k;
    if (compareShifted(value, shift, min) >= 0 && compareShifted(value, shift, max) <= 0) shifts.push(shift);
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
    if (compareShifted(maxB, shift, minA) >= 0 && compareShifted(minB, shift, maxA) <= 0) shifts.push(shift);
  }
  return shifts;
}

/**
 * This function gives `true` when an edge of the rings `a` and an edge of the rings `b` have a common point. The rings
 * `b` move by `dx`, with no rounding. Each test of a box compares a moved value by `compareShifted`. So a test of a
 * box does not skip a pair of edges that meet. The rings can also be lines, which do not close.
 */
export function edgesMeet(a: Part, b: Part, dx: number): boolean {
  for (const ringA of a.rings) {
    for (let i = 0; i + 1 < ringA.length; i += 1) {
      const p = ringA[i] as Position;
      const q = ringA[i + 1] as Position;
      const pMinX = Math.min(p[0], q[0]);
      const pMaxX = Math.max(p[0], q[0]);
      const pMinY = Math.min(p[1], q[1]);
      const pMaxY = Math.max(p[1], q[1]);
      if (pMaxY < b.minY || pMinY > b.maxY || compareShifted(b.minX, dx, pMaxX) > 0 || compareShifted(b.maxX, dx, pMinX) < 0) continue;
      for (const ringB of b.rings) {
        for (let j = 0; j + 1 < ringB.length; j += 1) {
          const r = ringB[j] as Position;
          const s = ringB[j + 1] as Position;
          if (Math.max(r[1], s[1]) < pMinY || Math.min(r[1], s[1]) > pMaxY) continue;
          if (compareShifted(Math.max(r[0], s[0]), dx, pMinX) < 0 || compareShifted(Math.min(r[0], s[0]), dx, pMaxX) > 0) continue;
          if (classifySegmentsShifted(p[0], p[1], q[0], q[1], r[0], r[1], s[0], s[1], dx, 0).relation !== "disjoint") return true;
        }
      }
    }
  }
  return false;
}

/**
 * This function gives `true` when two closed polygons with holes have a common point in the plane. The polygon `b`
 * moves by `dx`, with no rounding. So the result is exact.
 *
 * When no edge of `a` meets an edge of `b`, each boundary is fully inside or fully outside the other polygon. Then the
 * polygons meet only when a vertex of one exterior is in the other polygon.
 */
export function partsMeet(a: Part, b: Part, dx: number): boolean {
  if (a.maxY < b.minY || a.minY > b.maxY || compareShifted(b.minX, dx, a.maxX) > 0 || compareShifted(b.maxX, dx, a.minX) < 0) return false;
  if (edgesMeet(a, b, dx)) return true;
  const vertexA = a.rings[0]?.[0];
  if (vertexA !== undefined && locateInRings(b.rings, vertexA[0], vertexA[1], dx) !== "outside") return true;
  const vertexB = b.rings[0]?.[0];
  // The vertex of b moves by dx. The test moves the rings of a by -dx in its place, with no rounding.
  return vertexB !== undefined && locateInRings(a.rings, vertexB[0], vertexB[1], 0 - dx) !== "outside";
}
