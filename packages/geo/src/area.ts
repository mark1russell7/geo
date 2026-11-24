/**
 * The area of a polygon on an ellipsoid, and the area of the common part of two or more polygons.
 *
 * RFC 7946 (section 3.1) says that an edge is a straight line in longitude and latitude. So a polygon is a region of
 * the plane of longitude and latitude, and its area is the area of that region on the ellipsoid. The theorem of Green
 * changes the area integral into a sum over the edges. Each edge gives an integral of the authalic function `F`, the
 * area from the equator to a latitude for one radian of longitude. Gauss-Legendre quadrature gives that integral.
 *
 * For an edge of a parcel, the result is exact to the rounding of a double. For an edge of 40 degrees, the tests hold
 * the relative error under 1e-9.
 *
 * The overlap uses a fan of signed triangles from one corner of each ring. The sign of a triangle times its region
 * gives the winding number of the ring. So the common part of polygons is a signed sum of the common parts of one
 * triangle of each polygon. The common part of triangles is a convex polygon. This sum is exact for each measure,
 * and the area is a measure. Each ring must not cross itself, and the holes must be inside their exterior, as RFC 7946 tells.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import { checkEllipsoid, WGS84, type Ellipsoid } from "./geodesic.ts";
import type { MultiPolygon, Polygon } from "./geojson.ts";
import { overlappingShifts, polygonParts, type Part, type Ring } from "./planar.ts";

const DEGREE = Math.PI / 180;

/** A corner in the plane of longitude and latitude, in degrees. */
type Corner = readonly [number, number];

/** The nodes and the weights of the Gauss-Legendre rule of 5 points on the range from 0 to 1. */
const GAUSS_NODES: readonly (readonly [number, number])[] = (() => {
  const a = Math.sqrt(5 - 2 * Math.sqrt(10 / 7)) / 3;
  const b = Math.sqrt(5 + 2 * Math.sqrt(10 / 7)) / 3;
  const wa = (322 + 13 * Math.sqrt(70)) / 900;
  const wb = (322 - 13 * Math.sqrt(70)) / 900;
  const raw: readonly (readonly [number, number])[] = [
    [0, 128 / 225],
    [-a, wa],
    [a, wa],
    [-b, wb],
    [b, wb],
  ];
  return raw.map(([x, w]) => [(x + 1) / 2, w / 2] as const);
})();

/** The most degrees of latitude in one piece of an edge for the quadrature. */
const PIECE_DEGREES = 5;

/**
 * This function gives the authalic function of an ellipsoid. Its value is the area in square metres from the equator
 * to the latitude `lat` in degrees, for one radian of longitude.
 */
function authalic(ellipsoid: Ellipsoid): (lat: number) => number {
  const a = ellipsoid.equatorialRadiusMeters;
  const f = ellipsoid.flattening;
  const e2 = f * (2 - f);
  const b2 = a * a * (1 - f) * (1 - f);
  // The term atanh(e s) / e, also for a sphere (e = 0) and for a prolate ellipsoid (e^2 < 0).
  const term =
    e2 > 0
      ? (s: number) => Math.atanh(Math.sqrt(e2) * s) / Math.sqrt(e2)
      : e2 < 0
        ? (s: number) => Math.atan(Math.sqrt(-e2) * s) / Math.sqrt(-e2)
        : (s: number) => s;
  return (lat) => {
    const s = Math.sin(lat * DEGREE);
    return (b2 / 2) * (s / (1 - e2 * s * s) + term(s));
  };
}

/**
 * This function gives the area of the region inside a ring, with a sign. The sign is positive for a counterclockwise
 * ring in the plane of longitude and latitude. The ring can be closed or open.
 */
function signedRingArea(ring: readonly Corner[], F: (lat: number) => number): number {
  const n = ring.length;
  if (n < 3) return 0;
  // A constant added to F changes no closed sum. The latitude of the first corner keeps the terms small.
  const base = F(ring[0]![1]);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    const dx = x2 - x1;
    if (dx === 0) continue;
    const dy = y2 - y1;
    let mean: number;
    if (dy === 0) {
      mean = F(y1) - base;
    } else {
      const pieces = Math.max(1, Math.ceil(Math.abs(dy) / PIECE_DEGREES));
      mean = 0;
      for (let p = 0; p < pieces; p += 1) {
        for (const [t, w] of GAUSS_NODES) mean += (w / pieces) * (F(y1 + ((p + t) / pieces) * dy) - base);
      }
    }
    sum -= mean * dx * DEGREE;
  }
  return sum;
}

/** This function gives the area of one polygon of the plane: the exterior less the holes. */
function partArea(part: Part, F: (lat: number) => number): number {
  return part.rings.reduce((area, ring, index) => {
    const size = Math.abs(signedRingArea(ring as readonly Corner[], F));
    return index === 0 ? area + size : area - size;
  }, 0);
}

/**
 * This function gives the area of a Polygon or a MultiPolygon on an ellipsoid, in square metres. An edge is a straight
 * line in longitude and latitude, as RFC 7946 tells. The direction of a ring does not change the result.
 *
 * @param polygon - The polygon. The holes of a polygon must be inside its exterior, and the polygons of a MultiPolygon
 *   must not overlap.
 * @param ellipsoid - The ellipsoid. The default is `WGS84`.
 * @throws GeoError - The geometry is not a valid Polygon or MultiPolygon, or the ellipsoid is not valid.
 */
export function areaSquareMeters(polygon: Polygon | MultiPolygon, ellipsoid: Ellipsoid = WGS84): number {
  checkEllipsoid(ellipsoid);
  const F = authalic(ellipsoid);
  return polygonParts(polygon).reduce((area, part) => area + partArea(part, F), 0);
}

/** A triangle of the fan of a ring, with its weight (1 or -1) and its extent. */
interface Triangle {
  readonly corners: readonly [Corner, Corner, Corner];
  readonly weight: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** This function gives the signed fan triangles of the rings of a polygon, with the longitudes moved by `dx`. */
function fanOf(part: Part, dx: number): Triangle[] {
  const triangles: Triangle[] = [];
  part.rings.forEach((ring, index) => {
    const corners = openRing(ring).map(([x, y]) => [x! + dx, y!] as const);
    if (corners.length < 3) return;
    const orientation = Math.sign(planeArea(corners));
    if (orientation === 0) return;
    // A hole takes its region away from the exterior.
    const role = index === 0 ? 1 : -1;
    const o = corners[0]!;
    for (let k = 1; k + 1 < corners.length; k += 1) {
      const p = corners[k]!;
      const q = corners[k + 1]!;
      const sign = Math.sign((p[0] - o[0]) * (q[1] - o[1]) - (q[0] - o[0]) * (p[1] - o[1]));
      if (sign === 0) continue;
      triangles.push({
        corners: [o, p, q],
        weight: sign * orientation * role,
        minX: Math.min(o[0], p[0], q[0]),
        maxX: Math.max(o[0], p[0], q[0]),
        minY: Math.min(o[1], p[1], q[1]),
        maxY: Math.max(o[1], p[1], q[1]),
      });
    }
  });
  return triangles;
}

/** This function gives the corners of a ring without the copy of the first corner at the end. */
function openRing(ring: Ring): Ring {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return ring.length > 1 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
}

/** This function gives the signed area of a ring in the plane of longitude and latitude, by the shoelace formula. */
function planeArea(ring: readonly Corner[]): number {
  let twice = 0;
  const [ox, oy] = ring[0]!;
  for (let i = 1; i + 1 < ring.length; i += 1) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[i + 1]!;
    twice += (ax - ox) * (by - oy) - (bx - ox) * (ay - oy);
  }
  return twice / 2;
}

/**
 * This function gives the part of a convex ring on the left side of the line from `p` to `q`. It uses the steps of
 * Sutherland and Hodgman. The ring is counterclockwise, and the result is convex. It is empty when no part is on the left.
 */
function clipLeft(ring: readonly Corner[], p: Corner, q: Corner): Corner[] {
  const out: Corner[] = [];
  const side = (c: Corner): number => (q[0] - p[0]) * (c[1] - p[1]) - (q[1] - p[1]) * (c[0] - p[0]);
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/** This function gives the corners of a triangle in the counterclockwise order. */
function counterclockwise(t: Triangle): readonly Corner[] {
  const [o, p, q] = t.corners;
  return (p[0] - o[0]) * (q[1] - o[1]) - (q[0] - o[0]) * (p[1] - o[1]) > 0 ? [o, p, q] : [o, q, p];
}

/** This function gives the part of a convex counterclockwise ring inside a triangle. The result is convex. */
function clipToTriangle(ring: readonly Corner[], t: Triangle): readonly Corner[] {
  const clip = counterclockwise(t);
  let out = ring;
  for (let i = 0; i < 3 && out.length >= 3; i += 1) out = clipLeft(out, clip[i]!, clip[(i + 1) % 3]!);
  return out;
}

/** An extent in the plane of longitude and latitude. */
interface Extent {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const meets = (a: Extent, b: Extent): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** This function gives the extent of a ring. */
function extentOf(ring: readonly Corner[]): Extent {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * This function gives the signed sum of the areas of the common parts of one triangle of each fan. The common part of
 * convex regions is convex, so each step clips a convex ring with the next triangle.
 */
function fansCommon(fans: readonly (readonly Triangle[])[], F: (lat: number) => number): number {
  const step = (level: number, ring: readonly Corner[], weight: number): number => {
    if (level === fans.length) return weight * Math.abs(signedRingArea(ring, F));
    const extent = extentOf(ring);
    let sum = 0;
    for (const t of fans[level]!) {
      if (!meets(t, extent)) continue;
      const next = clipToTriangle(ring, t);
      if (next.length >= 3) sum += step(level + 1, next, weight * t.weight);
    }
    return sum;
  };
  return fans[0]!.reduce((sum, t) => sum + step(1, counterclockwise(t), t.weight), 0);
}

/** This function gives the area of the common part of polygons of the plane, each moved by its shift in degrees. */
function partsCommon(parts: readonly Part[], shifts: readonly number[], F: (lat: number) => number): number {
  const common: Extent = {
    minX: Math.max(...parts.map((part, i) => part.minX + shifts[i]!)),
    maxX: Math.min(...parts.map((part, i) => part.maxX + shifts[i]!)),
    minY: Math.max(...parts.map((part) => part.minY)),
    maxY: Math.min(...parts.map((part) => part.maxY)),
  };
  if (common.minX > common.maxX || common.minY > common.maxY) return 0;
  // Only the triangles that meet the common extent can be in the common part.
  const fans = parts.map((part, i) => fanOf(part, shifts[i]!).filter((t) => meets(t, common)));
  return fans.some((fan) => fan.length === 0) ? 0 : fansCommon(fans, F);
}

/**
 * This function gives the area of the part that all the Polygons and MultiPolygons have in common, on an ellipsoid, in
 * square metres. An edge is a straight line in longitude and latitude, as RFC 7946 tells. The polygons can cross the
 * antimeridian: a polygon moved by 360 degrees is the same area of the Earth. For one polygon, the result is its area.
 *
 * The work is in proportion to the product of the numbers of corners of the polygons in their common extent. The
 * result is not less than 0 and not more than the area of each polygon, to the rounding of the sum.
 *
 * @param polygons - The polygons. The holes of a polygon must be inside its exterior, and the polygons of a
 *   MultiPolygon must not overlap.
 * @param ellipsoid - The ellipsoid. The default is `WGS84`.
 * @throws GeoError - The list is empty, a geometry is not a valid Polygon or MultiPolygon, or the ellipsoid is not valid.
 */
export function commonAreaSquareMeters(polygons: readonly (Polygon | MultiPolygon)[], ellipsoid: Ellipsoid = WGS84): number {
  checkEllipsoid(ellipsoid);
  const [first, ...rest] = polygons;
  if (first === undefined) throw new GeoError("geojson-member", "The list of polygons is empty");
  if (rest.length === 0) return areaSquareMeters(first, ellipsoid);
  const F = authalic(ellipsoid);
  const partLists = polygons.map((polygon) => polygonParts(polygon));
  let sum = 0;
  // Each choice of one part of each polygon, and each shift of the later parts that can meet the first part.
  const choose = (level: number, parts: Part[], shifts: number[]): void => {
    if (level === partLists.length) {
      sum += partsCommon(parts, shifts, F);
      return;
    }
    for (const part of partLists[level]!) {
      const options = level === 0 ? [0] : overlappingShifts(parts[0]!.minX, parts[0]!.maxX, part.minX, part.maxX);
      for (const shift of options) choose(level + 1, [...parts, part], [...shifts, shift]);
    }
  };
  choose(0, [], []);
  return Math.max(0, sum);
}

/**
 * This function gives the area of the overlap of two Polygons or MultiPolygons on an ellipsoid, in square metres. It
 * is `commonAreaSquareMeters([a, b], ellipsoid)`.
 *
 * @param a - The first polygon. The holes of a polygon must be inside its exterior, and the polygons of a
 *   MultiPolygon must not overlap.
 * @param b - The second polygon, with the same rules.
 * @param ellipsoid - The ellipsoid. The default is `WGS84`.
 * @throws GeoError - A geometry is not a valid Polygon or MultiPolygon, or the ellipsoid is not valid.
 */
export function overlapAreaSquareMeters(a: Polygon | MultiPolygon, b: Polygon | MultiPolygon, ellipsoid: Ellipsoid = WGS84): number {
  return commonAreaSquareMeters([a, b], ellipsoid);
}
