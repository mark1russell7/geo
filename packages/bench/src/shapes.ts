/**
 * This module makes the seeded cases of the bench of `locatePoint`: one polygon and a list of places for each case. No
 * real map data goes into the repository.
 *
 * The shapes:
 *
 * - `coast`: one region of the map of `map.ts`, with a rough coast on each of its 4 sides. Its edges do not cross. A
 *   county or a forecast zone with a coast has this shape. A horizontal line crosses few of its edges.
 * - `star`: a ring of spikes around a center. A horizontal line crosses approximately one quarter of its edges. Thus it
 *   is the hard case of a test that counts the crossings of a ray.
 * - `parts`: the 552 regions of a map of `map.ts` as one MultiPolygon. A zone with many islands has many parts.
 *
 * The places: 98 % are uniform points in the box of the polygon with a margin of 5 %, and 2 % are vertices of the
 * polygon. Each value has 6 decimals, as in usual GeoJSON data.
 *
 * @packageDocumentation
 */

import type { LatLon, MultiPolygon, Polygon, Position } from "@mark1russell7/geo";
import { random } from "@mark1russell7/rigor-generators";
import { mapOf } from "./map.ts";

/** The shape of the polygon of a case. */
export type Shape = "coast" | "star" | "parts";

/** A case of the bench of `locatePoint`: a shape with the target count of positions, and the count of places. */
export interface LocateSpec {
  readonly id: string;
  readonly shape: Shape;
  /** The target count of positions over all rings, with the closing position of each ring. */
  readonly vertices: number;
  readonly places: number;
}

/**
 * The cases of the bench. The case `coast-1e5-1e4` is the target of the roadmap item R10: a polygon with 100,000
 * vertices and 10,000 places. The product of the vertices and the places is at most 1e9, so the base of a scan can
 * finish each round.
 */
export const LOCATE_CASES: readonly LocateSpec[] = [
  { id: "coast-1e3-1e4", shape: "coast", vertices: 1_000, places: 10_000 },
  { id: "coast-1e4-1e4", shape: "coast", vertices: 10_000, places: 10_000 },
  { id: "coast-1e5-1e4", shape: "coast", vertices: 100_000, places: 10_000 },
  { id: "coast-1e6-1e2", shape: "coast", vertices: 1_000_000, places: 100 },
  { id: "star-1e5-1e3", shape: "star", vertices: 100_000, places: 1_000 },
  { id: "parts-552-1e5-1e3", shape: "parts", vertices: 100_000, places: 1_000 },
];

/** This function gives the case with the id, or a `RangeError`. */
export function locateCaseOf(id: string): LocateSpec {
  const found = LOCATE_CASES.find((spec) => spec.id === id);
  if (found === undefined) {
    throw new RangeError(`There is no locate case ${id}. The cases: ${LOCATE_CASES.map((spec) => spec.id).join(", ")}`);
  }
  return found;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** The center of a star, in the box of the map of `map.ts`. */
const STAR_CENTER: Position = [-99, 31.25];
/** The radii of the tips and of the valleys of a star, in degrees. */
const STAR_OUTER = 5;
const STAR_INNER = 2.5;

/**
 * This function gives a star with the count of positions: a closed counterclockwise ring. The angle of each vertex
 * grows, so no edge crosses another edge.
 */
function starOf(spec: LocateSpec): Polygon {
  const draw = random(`geo-bench:locate:${spec.id}`);
  const count = Math.max(3, spec.vertices - 1);
  const ring: Position[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (2 * Math.PI * index) / count;
    const radius = (index % 2 === 0 ? STAR_OUTER : STAR_INNER) * draw.range(0.95, 1.05);
    ring.push([round6(STAR_CENTER[0] + radius * Math.cos(angle)), round6(STAR_CENTER[1] + radius * Math.sin(angle))]);
  }
  ring.push(ring[0] as Position);
  return { type: "Polygon", coordinates: [ring] };
}

/** This function gives the polygon of a case. */
export function polygonOf(spec: LocateSpec): Polygon | MultiPolygon {
  switch (spec.shape) {
    case "coast":
      return mapOf({ id: `locate:${spec.id}`, columns: 1, rows: 1, positions: spec.vertices })[0] as Polygon;
    case "star":
      return starOf(spec);
    case "parts": {
      const regions = mapOf({ id: `locate:${spec.id}`, columns: 24, rows: 23, positions: spec.vertices });
      return { type: "MultiPolygon", coordinates: regions.map((region) => region.coordinates) };
    }
  }
}

/** This function gives each position of each ring of the polygon, with the closing positions. */
export function positionsOf(polygon: Polygon | MultiPolygon): Position[] {
  const polygons = polygon.type === "Polygon" ? [polygon.coordinates] : polygon.coordinates;
  return polygons.flatMap((rings) => rings.flat());
}

/** The share of the places at a vertex of the polygon. */
const VERTEX_SHARE = 0.02;
/** The margin around the box of the polygon, as a part of its width and of its height. */
const MARGIN = 0.05;

/** This function gives the seeded places of a case: uniform points in the box of the polygon, and some vertices. */
export function placesOf(spec: LocateSpec, polygon: Polygon | MultiPolygon): LatLon[] {
  const positions = positionsOf(polygon);
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [x, y] of positions) {
    west = Math.min(west, x);
    east = Math.max(east, x);
    south = Math.min(south, y);
    north = Math.max(north, y);
  }
  const dx = (east - west) * MARGIN;
  const dy = (north - south) * MARGIN;
  const draw = random(`geo-bench:places:${spec.id}`);
  return Array.from({ length: spec.places }, (): LatLon => {
    if (draw.chance(VERTEX_SHARE)) {
      const [lon, lat] = positions[draw.below(positions.length)] as Position;
      return { lat, lon };
    }
    return { lat: round6(draw.range(south - dy, north + dy)), lon: round6(draw.range(west - dx, east + dx)) };
  });
}
