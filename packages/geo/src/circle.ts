/**
 * This module gives a circle on the Earth as a GeoJSON polygon. A point is in the circle when its great-circle distance
 * to the center is equal to the radius or less.
 *
 * The rules:
 *
 * - The ring has one vertex at each of `vertices` bearings from the center, at equal steps. The first vertex is to the
 *   north of the center.
 * - An edge is a straight line in longitude and latitude, as in RFC 7946 and in the other functions of this package.
 * - The result follows RFC 7946. Each longitude is from -180 to 180. The exterior ring goes counterclockwise, and a
 *   hole goes clockwise.
 * - A circle across the antimeridian is a `MultiPolygon` of two parts. The cut is at 180 and at -180.
 * - A circle around one pole is a `Polygon` from -180 to 180, with an edge along the pole.
 * - A circle around the two poles is the Earth less the opposite circle, as one `Polygon`.
 * - A circle with a radius of half the circumference of the sphere or more is the whole Earth.
 * - A vertex at a pole becomes an edge along the pole. Thus a pole on the circle is on the boundary.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import type { MultiPolygon, Polygon } from "./geojson.ts";
import { checkPoint, normalizeLon, type LatLon, type Position } from "./point.ts";
import { ringWinding } from "./polygon.ts";
import { checkRadius, destinationByAngle, EARTH_MEAN_RADIUS_KM, EARTH_MEAN_RADIUS_METERS } from "./sphere.ts";

/** The default number of the vertices of a circle. */
export const DEFAULT_CIRCLE_VERTICES = 64;

/** The maximum number of the vertices of a circle. The limit keeps the work and the size of a result small. */
export const MAX_CIRCLE_VERTICES = 65_536;

/** The options of `circleKm` and `circleMeters`. */
export interface CircleOptions {
  /**
   * The number of the vertices on the circle, an integer from 3 to `MAX_CIRCLE_VERTICES`. The default is
   * `DEFAULT_CIRCLE_VERTICES`. More vertices give a polygon nearer to the circle.
   */
  readonly vertices?: number;
}

/** A vertex of a ring, with its longitude from -180 to 180. */
interface Vertex {
  readonly lon: number;
  readonly lat: number;
}

/** The whole Earth as a ring, counterclockwise. */
const WORLD: readonly Position[] = [
  [-180, -90],
  [180, -90],
  [180, 90],
  [-180, 90],
  [-180, -90],
];

/** This function gives the difference of two longitudes, from -180 (not included) to 180. */
function lonDifference(a: number, b: number): number {
  const d = (a - b) % 360;
  if (d > 180) return d - 360;
  if (d <= -180) return d + 360;
  return d;
}

/** This function gives the latitude at a part `t` from 0 to 1 of the way from `a` to `b`. */
function mix(a: number, b: number, t: number): number {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const value = a + t * (b - a);
  return Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b));
}

const same = (a: Position, b: Position): boolean => a[0] === b[0] && a[1] === b[1];

/**
 * This function tells if a ring goes back at `b`. That occurs when `a`, `b` and `c` are on one meridian or one parallel,
 * and `b` is not between `a` and `c`. The positions next to each other must be different. The test has no arithmetic.
 */
function goesBack(a: Position, b: Position, c: Position): boolean {
  if (a[0] === b[0] && b[0] === c[0]) return (b[1] > a[1]) !== (c[1] > b[1]);
  if (a[1] === b[1] && b[1] === c[1]) return (b[0] > a[0]) !== (c[0] > b[0]);
  return false;
}

/**
 * This function closes a ring. It removes a position that is equal to the position before it. It also removes the tip
 * of each spike: a position where the ring goes back along the same meridian or parallel. A circle that touches a pole
 * makes such spikes. A ring with fewer than three positions after that keeps each position, so a circle that is too small for
 * the numbers stays a ring.
 */
function closeRing(positions: readonly Position[]): Position[] {
  const kept: Position[] = [];
  for (const p of positions) {
    if (kept.length > 0 && same(kept[kept.length - 1]!, p)) continue;
    let skip = false;
    while (kept.length >= 2 && goesBack(kept[kept.length - 2]!, kept[kept.length - 1]!, p)) {
      kept.pop();
      if (same(kept[kept.length - 1]!, p)) {
        skip = true;
        break;
      }
    }
    if (!skip) kept.push(p);
  }
  // The end of the ring meets its start: the same two tests apply across that seam.
  for (let changed = true; changed && kept.length >= 3; ) {
    const n = kept.length;
    changed = true;
    if (same(kept[0]!, kept[n - 1]!) || goesBack(kept[n - 2]!, kept[n - 1]!, kept[0]!)) kept.pop();
    else if (goesBack(kept[n - 1]!, kept[0]!, kept[1]!)) kept.shift();
    else changed = false;
  }
  const ring = kept.length >= 3 ? kept : [...positions];
  return [...ring, ring[0]!];
}

/**
 * This function gives the vertices on a circle, counterclockwise from the north of the center. A vertex at a pole
 * becomes two vertices on the pole. One has the longitude of the vertex before it, and one has the longitude of the
 * vertex after it.
 */
function circleVertices(center: LatLon, angle: number, count: number): Vertex[] {
  const points: LatLon[] = [];
  for (let k = 0; k < count; k += 1) points.push(destinationByAngle(center, (-360 * k) / count, angle));
  const atPole = (p: LatLon): boolean => p.lat === 90 || p.lat === -90;
  // A circle that is too small for the numbers at a pole has each vertex at the pole. The longitude of the center
  // keeps such a ring at one position.
  if (points.every(atPole)) return points.map((p) => ({ lon: normalizeLon(center.lon), lat: p.lat }));
  const vertices: Vertex[] = [];
  for (let k = 0; k < count; k += 1) {
    const point = points[k]!;
    if (!atPole(point)) {
      vertices.push({ lon: point.lon, lat: point.lat });
      continue;
    }
    let before = (k + count - 1) % count;
    while (atPole(points[before]!)) before = (before + count - 1) % count;
    let after = (k + 1) % count;
    while (atPole(points[after]!)) after = (after + 1) % count;
    vertices.push({ lon: points[before]!.lon, lat: point.lat }, { lon: points[after]!.lon, lat: point.lat });
  }
  return vertices;
}

/** The two parts of a circle that is cut at the antimeridian, or the one ring of a circle that is not cut. */
type Cut =
  | { readonly kind: "whole"; readonly ring: Position[] }
  | {
      readonly kind: "cut";
      /** The latitude where the ring goes to the east of 180, and the latitude where it comes back. */
      readonly out: number;
      readonly back: number;
      /** The vertices to the west of the cut, from `back` to `out`, with the longitudes up to 180. */
      readonly west: Position[];
      /** The vertices to the east of the cut, from `out` to `back`, with the longitudes from -180. */
      readonly east: Position[];
    };

/**
 * This function cuts the ring of a circle that does not go around a pole at the antimeridian. Each longitude of such a
 * circle is within 90 degrees of the center. So the ring crosses the antimeridian two times or not at all, and the sign
 * of a longitude tells its side with no rounding.
 */
function cutAtAntimeridian(vertices: readonly Vertex[], centerLon: number): Cut {
  const center = normalizeLon(centerLon);
  const far = Math.abs(center) > 90;
  // A vertex at -180 is on the cut, so it is not on a side.
  const isEast = vertices.map((v) => far && v.lon < 0 && v.lon > -180);
  const isWest = vertices.map((v) => far && v.lon > 0);
  if (!isEast.includes(true) || !isWest.includes(true)) {
    // The ring does not cross the antimeridian. A vertex on the antimeridian goes to the side of the other vertices.
    const side = isEast.includes(true) || (!isWest.includes(true) && center < 0) ? -180 : 180;
    const ring = vertices.map((v): Position => [v.lon === -180 ? side : v.lon, v.lat]);
    return { kind: "whole", ring: closeRing(ring) };
  }
  const count = vertices.length;
  const east = (i: number): boolean => isEast[i % count]!;
  // The longitudes past 180 to the east give the latitude of a crossing. Their rounding changes only that latitude.
  const unwrapped = (i: number): number => (isEast[i] ? vertices[i]!.lon + 360 : Math.abs(vertices[i]!.lon));
  const crossing = (i: number): number => {
    const j = (i + 1) % count;
    const t = (180 - unwrapped(i)) / (unwrapped(j) - unwrapped(i));
    return mix(vertices[i]!.lat, vertices[j]!.lat, t);
  };
  let goesOut = -1;
  let comesBack = -1;
  for (let i = 0; i < count; i += 1) {
    if (!east(i) && east(i + 1) && goesOut < 0) goesOut = i;
    if (east(i) && !east(i + 1) && comesBack < 0) comesBack = i;
  }
  const west: Position[] = [];
  for (let i = (comesBack + 1) % count; ; i = (i + 1) % count) {
    const v = vertices[i]!;
    west.push([v.lon === -180 ? 180 : v.lon, v.lat]);
    if (i === goesOut) break;
  }
  const eastPart: Position[] = [];
  for (let i = (goesOut + 1) % count; ; i = (i + 1) % count) {
    eastPart.push([vertices[i]!.lon, vertices[i]!.lat]);
    if (i === comesBack) break;
  }
  return { kind: "cut", out: crossing(goesOut), back: crossing(comesBack), west, east: eastPart };
}

/** This function gives a circle that does not go around a pole. A circle across the antimeridian has two parts. */
function aroundNoPole(vertices: readonly Vertex[], centerLon: number): Polygon | MultiPolygon {
  const cut = cutAtAntimeridian(vertices, centerLon);
  if (cut.kind === "whole") return { type: "Polygon", coordinates: [cut.ring] };
  const west = closeRing([[180, cut.back], ...cut.west, [180, cut.out]]);
  const east = closeRing([[-180, cut.out], ...cut.east, [-180, cut.back]]);
  return { type: "MultiPolygon", coordinates: [[west], [east]] };
}

/**
 * This function gives a circle around one pole. The longitudes of its vertices go up (north) or down (south) with one
 * step back at the antimeridian. The ring follows them from -180 to 180 and closes along the pole.
 */
function aroundOnePole(vertices: readonly Vertex[], north: boolean): Polygon {
  const count = vertices.length;
  let step = 0;
  let best = Infinity;
  for (let i = 0; i < count; i += 1) {
    const d = vertices[(i + 1) % count]!.lon - vertices[i]!.lon;
    const score = north ? d : -d;
    if (score < best) {
      best = score;
      step = i;
    }
  }
  const a = vertices[step]!;
  const b = vertices[(step + 1) % count]!;
  const edge = north ? 180 : -180;
  const bLon = north ? b.lon + 360 : b.lon - 360;
  const lat = mix(a.lat, b.lat, (edge - a.lon) / (bLon - a.lon));
  const ordered: Position[] = [];
  for (let k = 1; k <= count; k += 1) {
    const v = vertices[(step + k) % count]!;
    ordered.push([v.lon, v.lat]);
  }
  const pole = north ? 90 : -90;
  return {
    type: "Polygon",
    coordinates: [closeRing([[-edge, lat], ...ordered, [edge, lat], [edge, pole], [-edge, pole]])],
  };
}

/** This function gives a circle around the two poles: the whole Earth less the opposite circle. */
function aroundTwoPoles(center: LatLon, angle: number, count: number): Polygon {
  const opposite: LatLon = { lat: -center.lat, lon: normalizeLon(center.lon + 180) };
  const vertices = circleVertices(opposite, Math.PI - angle, count);
  const cut = cutAtAntimeridian(vertices, opposite.lon);
  if (cut.kind === "whole") {
    // An opposite circle that is too small for the numbers has no area, so the circle is the whole Earth.
    if (ringWinding(cut.ring) === "degenerate") return { type: "Polygon", coordinates: [[...WORLD]] };
    return { type: "Polygon", coordinates: [[...WORLD], [...cut.ring].reverse()] };
  }
  // The exterior goes along the edges of the map, and around each part of the opposite circle at the antimeridian.
  const ring = closeRing([
    [-180, -90],
    [180, -90],
    [180, cut.out],
    ...[...cut.west].reverse(),
    [180, cut.back],
    [180, 90],
    [-180, 90],
    [-180, cut.back],
    ...[...cut.east].reverse(),
    [-180, cut.out],
  ]);
  return { type: "Polygon", coordinates: [ring] };
}

/** This function gives a circle from its center, its central angle in radians and its number of vertices. */
function circleByAngle(center: LatLon, angle: number, count: number): Polygon | MultiPolygon {
  if (angle >= Math.PI) return { type: "Polygon", coordinates: [[...WORLD]] };
  // The vertex to the north and the vertex to the south of the center tell if the circle goes around a pole: the
  // vertex is past the pole when its meridian is the opposite meridian of the center.
  const pastPole = (bearing: number, pole: number): boolean => {
    const p = destinationByAngle(center, bearing, angle);
    return p.lat !== pole && Math.abs(lonDifference(p.lon, center.lon)) > 90;
  };
  const north = pastPole(0, 90);
  // The bearing -180 is the bearing of the vertex to the south when the number of the vertices is even.
  const south = pastPole(-180, -90);
  if (north && south) return aroundTwoPoles(center, angle, count);
  const vertices = circleVertices(center, angle, count);
  if (north || south) return aroundOnePole(vertices, north);
  return aroundNoPole(vertices, center.lon);
}

/** This function examines the number of the vertices of a circle and gives it. */
function checkVertices(vertices: number | undefined): number {
  const count = vertices ?? DEFAULT_CIRCLE_VERTICES;
  if (!Number.isInteger(count) || count < 3 || count > MAX_CIRCLE_VERTICES) {
    throw new GeoError("vertices", `The number of the vertices ${count} must be an integer from 3 to ${MAX_CIRCLE_VERTICES}`);
  }
  return count;
}

/** This function examines the input of a circle and gives the circle. The distance and the sphere use one unit. */
function circle(center: LatLon, distance: number, sphereRadius: number, options: CircleOptions): Polygon | MultiPolygon {
  checkPoint(center);
  checkRadius(distance);
  checkRadius(sphereRadius);
  const count = checkVertices(options.vertices);
  // The test uses the distance and not the angle, so a radius of exactly half the circumference is the whole Earth.
  if (distance >= Math.PI * sphereRadius) return { type: "Polygon", coordinates: [[...WORLD]] };
  return circleByAngle(center, distance / sphereRadius, count);
}

/**
 * This function gives a circle on the Earth as a polygon. The radius is a great-circle distance in kilometres. The
 * module documentation gives the rules for the antimeridian and the poles.
 *
 * @param distance - The radius of the circle in kilometres, more than 0.
 * @param radiusKm - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_KM`.
 * @throws GeoError - The code is `not-finite`, `latitude-range`, `radius` or `vertices`.
 */
export function circleKm(
  center: LatLon,
  distance: number,
  options: CircleOptions = {},
  radiusKm: number = EARTH_MEAN_RADIUS_KM,
): Polygon | MultiPolygon {
  return circle(center, distance, radiusKm, options);
}

/**
 * This function gives a circle on the Earth as a polygon. The radius is a great-circle distance in metres. The module
 * documentation gives the rules for the antimeridian and the poles.
 *
 * @param distance - The radius of the circle in metres, more than 0.
 * @param radiusMeters - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_METERS`.
 * @throws GeoError - The code is `not-finite`, `latitude-range`, `radius` or `vertices`.
 */
export function circleMeters(
  center: LatLon,
  distance: number,
  options: CircleOptions = {},
  radiusMeters: number = EARTH_MEAN_RADIUS_METERS,
): Polygon | MultiPolygon {
  return circle(center, distance, radiusMeters, options);
}
