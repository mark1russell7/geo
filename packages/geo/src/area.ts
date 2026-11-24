/**
 * The area of a polygon on an ellipsoid, and the area of the overlap of two polygons.
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
 * gives the winding number of the ring. So the overlap of two polygons is a signed sum of the overlaps of their
 * triangles, and two triangles overlap in a convex polygon. This sum is exact for each measure, and the area is a
 * measure. Each ring must not cross itself, and the holes must be inside their exterior, as RFC 7946 tells.
 *
 * @packageDocumentation
 */

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

/** This function gives the area of the overlap of two triangles on the ellipsoid. */
function triangleOverlap(a: Triangle, b: Triangle, F: (lat: number) => number): number {
  const clip = counterclockwise(a);
  let ring: readonly Corner[] = counterclockwise(b);
  for (let i = 0; i < 3 && ring.length >= 3; i += 1) ring = clipLeft(ring, clip[i]!, clip[(i + 1) % 3]!);
  return ring.length >= 3 ? Math.abs(signedRingArea(ring, F)) : 0;
}

/** This function gives the area of the overlap of two polygons of the plane, with the second moved by `dx` degrees. */
function partOverlap(a: Part, b: Part, dx: number, F: (lat: number) => number): number {
  const minX = Math.max(a.minX, b.minX + dx);
  const maxX = Math.min(a.maxX, b.maxX + dx);
  const minY = Math.max(a.minY, b.minY);
  const maxY = Math.min(a.maxY, b.maxY);
  if (minX > maxX || minY > maxY) return 0;
  // Only the triangles that meet the common extent can overlap.
  const meets = (t: Triangle): boolean => t.minX <= maxX && t.maxX >= minX && t.minY <= maxY && t.maxY >= minY;
  const fanA = fanOf(a, 0).filter(meets);
  const fanB = fanOf(b, dx).filter(meets);
  let sum = 0;
  for (const ta of fanA) {
    for (const tb of fanB) {
      if (ta.minX > tb.maxX || tb.minX > ta.maxX || ta.minY > tb.maxY || tb.minY > ta.maxY) continue;
      sum += ta.weight * tb.weight * triangleOverlap(ta, tb, F);
    }
  }
  return sum;
}

/**
 * This function gives the area of the overlap of two Polygons or MultiPolygons on an ellipsoid, in square metres. An
 * edge is a straight line in longitude and latitude, as RFC 7946 tells. The polygons can cross the antimeridian: a
 * polygon moved by 360 degrees is the same area of the Earth.
 *
 * The work is in proportion to the product of the numbers of corners in the common extent of the two polygons.
 * The result is not less than 0 and not more than the area of each polygon, to the rounding of the sum.
 *
 * @param a - The first polygon. The holes of a polygon must be inside its exterior, and the polygons of a
 *   MultiPolygon must not overlap.
 * @param b - The second polygon, with the same rules.
 * @param ellipsoid - The ellipsoid. The default is `WGS84`.
 * @throws GeoError - A geometry is not a valid Polygon or MultiPolygon, or the ellipsoid is not valid.
 */
export function overlapAreaSquareMeters(a: Polygon | MultiPolygon, b: Polygon | MultiPolygon, ellipsoid: Ellipsoid = WGS84): number {
  checkEllipsoid(ellipsoid);
  const F = authalic(ellipsoid);
  const partsA = polygonParts(a);
  const partsB = polygonParts(b);
  let sum = 0;
  for (const pa of partsA) {
    for (const pb of partsB) {
      for (const dx of overlappingShifts(pa.minX, pa.maxX, pb.minX, pb.maxX)) sum += partOverlap(pa, pb, dx, F);
    }
  }
  return Math.max(0, sum);
}
