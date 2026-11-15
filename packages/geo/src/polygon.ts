/**
 * This module has the point-in-polygon test, the winding of rings, and the overlap of polygons and boxes, for GeoJSON
 * Polygon and MultiPolygon geometries.
 *
 * The rules:
 *
 * - An edge is a straight line in longitude and latitude (RFC 7946, section 3.1). The tests are exact in that plane.
 * - A polygon is a closed set. A point on an edge or on a vertex is on the boundary, and the boundary is in the polygon.
 * - The even-odd rule gives the inside of a ring. The first ring is the exterior, and the other rings are holes. A point
 *   in a hole is outside, and a point on the edge of a hole is on the boundary.
 * - The winding of a ring does not change a result, so a polygon that does not follow the right-hand rule is correct.
 * - A ring with fewer than four positions, or with a last position that is not equal to its first position, is
 *   refused with a `GeoError`. The functions do not close a ring.
 * - A longitude -180 is the longitude 180. A polygon can use longitudes past 180 to cross the antimeridian. Then the
 *   test examines the point at each of its longitudes in the range of the polygon.
 * - A point at latitude 90 or -90 is a pole, and all of its longitudes are the same point. The pole is on the boundary
 *   when a ring has a position at the pole. Otherwise, the pole is outside.
 *
 * @packageDocumentation
 */

import { dyadic } from "@mark1russell7/predicates";
import { GeoError } from "./errors.ts";
import { checkRing, type MultiPolygon, type Polygon } from "./geojson.ts";
import { checkBBox, type BBox } from "./bbox.ts";
import {
  locateInRings,
  overlappingShifts,
  partsMeet,
  polygonParts,
  shiftsInto,
  touchesLatitude,
  type Part,
  type PointLocation,
  type Ring,
  type Rings,
} from "./planar.ts";
import { checkPoint, normalizeLon, type LatLon, type Position } from "./point.ts";

export type { PointLocation } from "./planar.ts";

/** The winding of a ring in the plane of longitude and latitude. A ring with an area of 0 is `degenerate`. */
export type RingWinding = "counterclockwise" | "clockwise" | "degenerate";

function locateInPart(part: Part, point: LatLon): PointLocation {
  if (Math.abs(point.lat) === 90) return touchesLatitude(part.rings, point.lat) ? "boundary" : "outside";
  if (point.lat < part.minY || point.lat > part.maxY) return "outside";
  const lon = normalizeLon(point.lon);
  let result: PointLocation = "outside";
  for (const shift of shiftsInto(lon, part.minX, part.maxX)) {
    const where = locateInRings(part.rings, lon + shift, point.lat);
    if (where === "inside") return "inside";
    if (where === "boundary") result = "boundary";
  }
  return result;
}

/**
 * This function gives the location of a point against a Polygon or a MultiPolygon: `inside`, `boundary` or `outside`.
 * The rules are in the description of this module. A point on the boundary of one part and inside another part is
 * `inside`.
 *
 * @throws GeoError - The code is `geojson-type`, `position`, `too-few-positions`, `ring-not-closed`, `not-finite` or
 *   `latitude-range`.
 */
export function locatePoint(point: LatLon, polygon: Polygon | MultiPolygon): PointLocation {
  checkPoint(point);
  let result: PointLocation = "outside";
  for (const part of polygonParts(polygon)) {
    const where = locateInPart(part, point);
    if (where === "inside") return "inside";
    if (where === "boundary") result = "boundary";
  }
  return result;
}

/**
 * This function gives `true` when the closed polygon has the point: the point is inside or on the boundary.
 *
 * @throws GeoError - As `locatePoint`.
 */
export function pointInPolygon(point: LatLon, polygon: Polygon | MultiPolygon): boolean {
  return locatePoint(point, polygon) !== "outside";
}

/**
 * This function gives the winding of a ring in the plane of longitude and latitude: the sign of its exact signed area.
 * The sum uses exact dyadic numbers, so a rounding error cannot change the result. For a ring that crosses itself, the
 * result is the sign of the sum of the signed areas of its loops.
 *
 * @throws GeoError - The code is `position`, `too-few-positions`, `ring-not-closed`, `not-finite` or `latitude-range`.
 */
export function ringWinding(ring: readonly Position[]): RingWinding {
  checkRing(ring, "");
  // The exact shoelace sum of x[i] * y[i + 1] - x[i + 1] * y[i].
  let sum = dyadic.fromFloat(0);
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const a = ring[index] as Position;
    const b = ring[index + 1] as Position;
    const term = dyadic.sub(
      dyadic.mul(dyadic.fromFloat(a[0]), dyadic.fromFloat(b[1])),
      dyadic.mul(dyadic.fromFloat(b[0]), dyadic.fromFloat(a[1])),
    );
    sum = dyadic.add(sum, term);
  }
  const sign = dyadic.sign(sum);
  if (sign > 0) return "counterclockwise";
  if (sign < 0) return "clockwise";
  return "degenerate";
}

function ringsOf(polygon: Polygon | MultiPolygon): readonly Rings[] {
  if (polygon.type === "Polygon") return [polygon.coordinates];
  if (polygon.type === "MultiPolygon") return polygon.coordinates;
  throw new GeoError("geojson-type", "The geometry must be a Polygon or a MultiPolygon");
}

/**
 * This function gives `true` when the polygon follows the right-hand rule of RFC 7946 (section 3.1.6): each exterior
 * ring is counterclockwise, and each hole is clockwise. A degenerate ring does not follow the rule.
 *
 * @throws GeoError - As `ringWinding`.
 */
export function followsRightHandRule(polygon: Polygon | MultiPolygon): boolean {
  return ringsOf(polygon).every((rings) =>
    rings.every((ring, index) => ringWinding(ring) === (index === 0 ? "counterclockwise" : "clockwise")),
  );
}

function rewindRings(rings: Rings): Rings {
  return rings.map((ring: Ring, index) => {
    const winding = ringWinding(ring);
    const wanted = index === 0 ? "counterclockwise" : "clockwise";
    return winding === "degenerate" || winding === wanted ? ring : [...ring].reverse();
  });
}

/**
 * This function gives a copy of the polygon that follows the right-hand rule of RFC 7946. It reverses each clockwise
 * exterior ring and each counterclockwise hole. It does not change a degenerate ring. The copy keeps
 * the other members of the object.
 *
 * @throws GeoError - As `ringWinding`.
 */
export function rewind<T extends Polygon | MultiPolygon>(polygon: T): T {
  if (polygon.type === "Polygon") return { ...polygon, coordinates: rewindRings((polygon as Polygon).coordinates) } as T;
  if (polygon.type === "MultiPolygon") {
    return { ...polygon, coordinates: (polygon as MultiPolygon).coordinates.map(rewindRings) } as T;
  }
  throw new GeoError("geojson-type", "The geometry must be a Polygon or a MultiPolygon");
}

function partsIntersect(a: Part, b: Part): boolean {
  if (a.maxY < b.minY || b.maxY < a.minY) return false;
  for (const pole of [90, -90]) {
    if (touchesLatitude(a.rings, pole) && touchesLatitude(b.rings, pole)) return true;
  }
  return overlappingShifts(a.minX, a.maxX, b.minX, b.maxX).some((shift) => partsMeet(a, b, shift));
}

/**
 * This function gives `true` when two closed polygons have a common point. Polygons that touch at one point
 * intersect. A polygon in a hole of the other polygon does not intersect it, unless they touch. The rules are in the
 * description of this module.
 *
 * The time is in proportion to the product of the numbers of edges, with a test of the boxes first.
 *
 * @throws GeoError - As `locatePoint`.
 */
export function polygonsIntersect(a: Polygon | MultiPolygon, b: Polygon | MultiPolygon): boolean {
  const partsA = polygonParts(a);
  const partsB = polygonParts(b);
  return partsA.some((partA) => partsB.some((partB) => partsIntersect(partA, partB)));
}

function rectangle(west: number, south: number, east: number, north: number): Part {
  const ring: Ring = [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
  return { rings: [ring], minX: west, maxX: east, minY: south, maxY: north };
}

/**
 * This function gives `true` when a closed polygon and a closed box have a common point. A box that crosses the
 * antimeridian is two rectangles, one on each side.
 *
 * @throws GeoError - As `locatePoint`, and the codes of a box: `longitude-range` and `bbox`.
 */
export function polygonIntersectsBBox(polygon: Polygon | MultiPolygon, box: BBox): boolean {
  checkBBox(box, "box");
  const rectangles =
    box.west <= box.east
      ? [rectangle(box.west, box.south, box.east, box.north)]
      : [rectangle(box.west, box.south, 180, box.north), rectangle(-180, box.south, box.east, box.north)];
  const parts = polygonParts(polygon);
  return parts.some((part) => rectangles.some((rect) => partsIntersect(part, rect)));
}
