/**
 * This module makes the seeded cases of the bench of `bufferKm`: one geometry, a distance and a tolerance for each
 * case. No real map data goes into the repository.
 *
 * The shapes:
 *
 * - `coast`: the polygon of the shape `coast` of `shapes.ts`, a region with a rough coast on each of its 4 sides.
 * - `line`: a line along the latitude 75 with a seeded wander. Near a pole, a cell is narrow in longitude.
 * - `points`: seeded points in the box of the map of `map.ts`. Their circles overlap.
 *
 * Two correct buffers can have different positions. Thus the result of a case is not the polygon: it is the class of
 * seeded sample points. A sample at a distance of `distance - tolerance` or less is in each correct buffer, and a
 * sample at `distance + tolerance` or more is out of it. The result skips each sample between the two limits. Thus each
 * correct buffer gives the same result.
 *
 * @packageDocumentation
 */

import {
  destinationKm,
  distanceToGeometryKm,
  type Geometry,
  type LatLon,
  type MultiPolygon,
  type Polygon,
  type Position,
  pointLocator,
} from "@mark1russell7/geo";
import { random } from "@mark1russell7/rigor-generators";
import { polygonOf } from "./shapes.ts";

/** The shape of the geometry of a buffer case. */
export type BufferShape = "coast" | "line" | "points";

/** A case of the bench of `bufferKm`. */
export interface BufferSpec {
  readonly id: string;
  readonly shape: BufferShape;
  /** The target count of positions of the geometry. */
  readonly vertices: number;
  readonly distanceKm: number;
  readonly toleranceKm: number;
  /** The count of the sample points of the result. */
  readonly samples: number;
}

/**
 * The cases of the bench. The 3 cases `coast-1e3-*` have one coast and 3 tolerances, from 3 km to 0.3 km. Thus they
 * give the growth of the time with the length of the boundary over the tolerance.
 */
export const BUFFER_CASES: readonly BufferSpec[] = [
  { id: "coast-1e3-t3", shape: "coast", vertices: 1_000, distanceKm: 10, toleranceKm: 3, samples: 2_000 },
  { id: "coast-1e3-t1", shape: "coast", vertices: 1_000, distanceKm: 10, toleranceKm: 1, samples: 2_000 },
  { id: "coast-1e3-t0.3", shape: "coast", vertices: 1_000, distanceKm: 10, toleranceKm: 0.3, samples: 2_000 },
  { id: "coast-1e5-t1", shape: "coast", vertices: 100_000, distanceKm: 10, toleranceKm: 1, samples: 200 },
  { id: "line-2e3-t1", shape: "line", vertices: 2_000, distanceKm: 10, toleranceKm: 1, samples: 2_000 },
  { id: "points-100-t1", shape: "points", vertices: 100, distanceKm: 10, toleranceKm: 1, samples: 2_000 },
];

/** This function gives the case with the id, or a `RangeError`. */
export function bufferCaseOf(id: string): BufferSpec {
  const found = BUFFER_CASES.find((spec) => spec.id === id);
  if (found === undefined) {
    throw new RangeError(`There is no buffer case ${id}. The cases: ${BUFFER_CASES.map((spec) => spec.id).join(", ")}`);
  }
  return found;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** The latitude of the line, the step of its longitude and the largest step of its latitude, in degrees. */
const LINE_LAT = 75;
const LINE_STEP = 0.08;
const LINE_WANDER = 0.02;

/** The box of the points: the box of the map of `map.ts`. */
const POINTS_BOX = { west: -104, east: -94, south: 26, north: 36.5 } as const;

/** This function gives the geometry of a case. */
export function bufferGeometryOf(spec: BufferSpec): Geometry {
  const draw = random(`geo-bench:buffer:${spec.id}`);
  switch (spec.shape) {
    case "coast":
      return polygonOf({ id: `buffer-${spec.vertices}`, shape: "coast", vertices: spec.vertices, places: 0 });
    case "line": {
      // The latitude wanders, and a pull back to the latitude of the line keeps it near that latitude.
      let lat = LINE_LAT;
      const coordinates = Array.from({ length: spec.vertices }, (_, index): Position => {
        lat = LINE_LAT + 0.98 * (lat - LINE_LAT) + draw.range(-LINE_WANDER, LINE_WANDER);
        return [round6(-80 + index * LINE_STEP), round6(lat)];
      });
      return { type: "LineString", coordinates };
    }
    case "points": {
      const { west, east, south, north } = POINTS_BOX;
      const coordinates = Array.from({ length: spec.vertices }, (): Position => [
        round6(draw.range(west, east)),
        round6(draw.range(south, north)),
      ]);
      return { type: "MultiPoint", coordinates };
    }
  }
}

/** This function gives each position of a geometry of a case. */
function positionsOfGeometry(geometry: Geometry): readonly Position[] {
  switch (geometry.type) {
    case "LineString":
    case "MultiPoint":
      return geometry.coordinates;
    case "Polygon":
      return geometry.coordinates.flat();
    default:
      throw new RangeError(`The bench makes no buffer case of the type ${geometry.type}`);
  }
}

/**
 * This function gives the seeded samples of a case. Half of them are uniform in the box of the buffer. The other half
 * are near the boundary: each is at a distance from `distance - 2 tolerance` to `distance + 2 tolerance` from a
 * position of the geometry.
 */
export function samplesOf(spec: BufferSpec, geometry: Geometry): LatLon[] {
  const positions = positionsOfGeometry(geometry);
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
  // One degree of latitude is approximately 111 km. The pad of the longitude grows with the latitude.
  const reach = (spec.distanceKm + 2 * spec.toleranceKm) / 111;
  const lonReach = reach / Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180);
  const draw = random(`geo-bench:buffer-samples:${spec.id}`);
  return Array.from({ length: spec.samples }, (_, index): LatLon => {
    if (index % 2 === 0) {
      return {
        lat: round6(draw.range(south - reach, north + reach)),
        lon: round6(draw.range(west - lonReach, east + lonReach)),
      };
    }
    const [lon, lat] = positions[draw.below(positions.length)] as Position;
    const km = draw.range(spec.distanceKm - 2 * spec.toleranceKm, spec.distanceKm + 2 * spec.toleranceKm);
    const point = destinationKm({ lat, lon }, draw.range(0, 360), km);
    return { lat: round6(point.lat), lon: round6(point.lon) };
  });
}

/** The class of the samples of a buffer: the count of samples in the band, and `1` (in) or `0` (out) for each other sample. */
export interface SampleClasses {
  readonly samples: number;
  readonly band: number;
  readonly classes: string;
  /** The count of samples on the wrong side of the buffer. A correct buffer gives 0. */
  readonly faults: number;
}

/** The class of each sample out of the band: `true` when the sample is at a distance of `distance - tolerance` or less. */
export function expectedClasses(spec: BufferSpec, geometry: Geometry, samples: readonly LatLon[]): (boolean | undefined)[] {
  return samples.map((sample) => {
    const km = distanceToGeometryKm(sample, geometry);
    if (km <= spec.distanceKm - spec.toleranceKm) return true;
    if (km >= spec.distanceKm + spec.toleranceKm) return false;
    return undefined;
  });
}

/** This function gives the classes of the samples in a buffer. The boundary of the buffer counts as in. */
export function classesOf(buffer: Polygon | MultiPolygon, expected: readonly (boolean | undefined)[], samples: readonly LatLon[]): SampleClasses {
  const locate = pointLocator(buffer);
  let band = 0;
  let faults = 0;
  let classes = "";
  samples.forEach((sample, index) => {
    const want = expected[index];
    if (want === undefined) {
      band += 1;
      return;
    }
    const isIn = locate(sample) !== "outside";
    if (isIn !== want) faults += 1;
    classes += isIn ? "1" : "0";
  });
  return { samples: samples.length, band, classes, faults };
}
