/**
 * This module has the point locator: an index of the edges of one Polygon or MultiPolygon in bands of latitude. The
 * locator gives the result of `locatePoint` for each point. It examines the polygon one time, so a test of many points
 * against one large polygon does not repeat that work.
 *
 * The index:
 *
 * - Each part keeps its edges in typed arrays. A band is a range of latitudes, and it has each edge that has a
 *   latitude in that range.
 * - The band of a latitude is a monotone function of the latitude. So the band of the point has each edge whose range
 *   of latitudes includes the latitude of the point. Each other edge misses the ray from the point, with no exception.
 * - The test of each edge is `rayEdge` of `@mark1russell7/predicates`, the exact test of `locatePoint`. So each result is
 *   the same as the result of `locatePoint`, also on the boundary and across the antimeridian.
 * - The count of bands keeps the index small: the mean count of the bands of an edge is approximately 5 or less.
 *
 * The time of one test is in proportion to the count of the edges in the band of the point. A ring with long edges in
 * latitude, for example a star, puts many edges in each band. Then a test examines many edges.
 *
 * @packageDocumentation
 */

import { rayEdge } from "@mark1russell7/predicates";
import type { MultiPolygon, Polygon } from "./geojson.ts";
import { polygonParts, type Part, type PartBox, type PointLocation } from "./planar.ts";
import { locateInParts } from "./polygon.ts";
import { checkPoint, type LatLon } from "./point.ts";

/** A function that gives the location of a point against the polygon of `pointLocator`: `inside`, `boundary` or `outside`. */
export type PointLocator = (point: LatLon) => PointLocation;

/** The target of the mean count of the bands of an edge, less 2 (the bands at the two ends). */
const BANDS_PER_EDGE = 3;

/** The index of one part: its edges in bands of latitude. */
interface BandedPart extends PartBox {
  /** The x and y of each position: x at `2 * i` and y at `2 * i + 1`. The edge `i` goes from the position `i` to `i + 1`. */
  readonly xy: Float64Array;
  /** The ring of each edge: 0 is the exterior, and the next rings are holes. */
  readonly ringOf: Uint32Array;
  /** The first entry of each band in `entries`. The entry at the index `bands` is the end of the last band. */
  readonly starts: Uint32Array;
  /** The edges of each band, in the order of the rings. */
  readonly entries: Uint32Array;
  /** The count of bands. */
  readonly bands: number;
  /** The height of each band in degrees of latitude. */
  readonly height: number;
}

/**
 * This function gives the band of the latitude `y` of the part. The result is a monotone function of `y`, also with
 * rounding: a float subtraction, a float division by a positive number and `Math.floor` do not change the order.
 */
function bandOf(part: Pick<BandedPart, "minY" | "bands" | "height">, y: number): number {
  if (part.bands === 1) return 0;
  const band = Math.floor((y - part.minY) / part.height);
  return band < part.bands ? band : part.bands - 1;
}

/**
 * This function gives the count of bands of a part with the edges `edges`. The extent of the edges in latitude is
 * `height`, and `spans` is the sum of the ranges of latitudes of the edges.
 */
function bandCount(edges: number, height: number, spans: number): number {
  if (edges === 0 || !(height > 0)) return 1;
  const count = spans > 0 ? Math.floor((BANDS_PER_EDGE * edges * height) / spans) : edges;
  const bands = Math.max(1, Math.min(edges, count));
  // A band height of 0 or a quotient that is not finite gives no order. One band has no division.
  const step = height / bands;
  return step > 0 && Number.isFinite(height / step) ? bands : 1;
}

/** This function gives the index of one part. The positions are valid, and each ring is closed. */
function bandedPart(part: Part): BandedPart {
  let positions = 0;
  for (const ring of part.rings) positions += ring.length;
  const xy = new Float64Array(2 * positions);
  const ringOf = new Uint32Array(positions);
  // The last position of each ring starts no edge: it is equal to the first position of the ring.
  const startsEdge = new Uint8Array(positions);
  let at = 0;
  part.rings.forEach((ring, ringIndex) => {
    ring.forEach((position, index) => {
      xy[2 * at] = position[0] as number;
      xy[2 * at + 1] = position[1] as number;
      ringOf[at] = ringIndex;
      startsEdge[at] = index + 1 < ring.length ? 1 : 0;
      at += 1;
    });
  });
  let edges = 0;
  let spans = 0;
  for (let i = 0; i < positions; i += 1) {
    if (startsEdge[i] === 0) continue;
    edges += 1;
    spans += Math.abs((xy[2 * i + 3] as number) - (xy[2 * i + 1] as number));
  }
  const bands = bandCount(edges, part.maxY - part.minY, spans);
  const shape = { minY: part.minY, bands, height: bands === 1 ? 0 : (part.maxY - part.minY) / bands };
  // The first band and the last band of each edge, by the position that starts it.
  const low = new Uint32Array(positions);
  const high = new Uint32Array(positions);
  // The entry at the index band + 1 counts the edges of the band. The sums then give the start of each band.
  const bandStarts = new Uint32Array(bands + 1);
  for (let i = 0; i < positions; i += 1) {
    if (startsEdge[i] === 0) continue;
    const ay = xy[2 * i + 1] as number;
    const by = xy[2 * i + 3] as number;
    low[i] = bandOf(shape, Math.min(ay, by));
    high[i] = bandOf(shape, Math.max(ay, by));
    for (let band = low[i] as number; band <= (high[i] as number); band += 1) bandStarts[band + 1] = (bandStarts[band + 1] as number) + 1;
  }
  for (let band = 0; band < bands; band += 1) bandStarts[band + 1] = (bandStarts[band + 1] as number) + (bandStarts[band] as number);
  const entries = new Uint32Array(bandStarts[bands] as number);
  const next = bandStarts.slice(0, bands);
  // The edges go into each band in the order of the positions, so the edges of each band are in the order of the rings.
  for (let i = 0; i < positions; i += 1) {
    if (startsEdge[i] === 0) continue;
    for (let band = low[i] as number; band <= (high[i] as number); band += 1) {
      entries[next[band] as number] = i;
      next[band] = (next[band] as number) + 1;
    }
  }
  return { minX: part.minX, maxX: part.maxX, minY: part.minY, maxY: part.maxY, xy, ringOf, starts: bandStarts, entries, bands, height: shape.height };
}

/**
 * This function is the plane test of a banded part, with the rule of holes of `locatePoint`. The edges of the band are
 * in the order of the rings, so each run of edges of one ring gives the parity of that ring. A ring with no edge in
 * the band does not contain the point.
 */
function inBands(part: BandedPart, x: number, y: number, dx: number): PointLocation {
  const band = bandOf(part, y);
  const { xy, ringOf, entries } = part;
  const end = part.starts[band + 1] as number;
  let ring = 0;
  let inside = false;
  for (let entry = part.starts[band] as number; entry < end; entry += 1) {
    const i = entries[entry] as number;
    const edgeRing = ringOf[i] as number;
    if (edgeRing !== ring) {
      // The run of the ring ends. A point out of the exterior or in a hole is outside.
      if ((ring === 0) !== inside) return "outside";
      ring = edgeRing;
      inside = false;
    }
    const where = rayEdge(xy[2 * i] as number, xy[2 * i + 1] as number, xy[2 * i + 2] as number, xy[2 * i + 3] as number, x, y, dx, 0);
    if (where === "boundary") return "boundary";
    if (where === "crosses") inside = !inside;
  }
  return (ring === 0) !== inside ? "outside" : "inside";
}

/**
 * This function examines a Polygon or a MultiPolygon one time, and gives a function that locates a point against it.
 * The result for each point is the same as the result of `locatePoint`. The rules are in the description of the module
 * of `locatePoint`.
 *
 * - The locator copies the positions. A later change of the polygon does not change the locator.
 * - The index needs approximately 40 bytes for each edge.
 * - The time of one test is in proportion to the count of the edges in the band of the point, not to all edges.
 *
 * @param polygon - The Polygon or the MultiPolygon.
 * @returns The locator. It refuses an incorrect point with a `GeoError`, as `locatePoint` does.
 * @throws GeoError - The code is `geojson-type`, `position`, `too-few-positions`, `ring-not-closed`, `not-finite`,
 *   `latitude-range` or `longitude-range`.
 */
export function pointLocator(polygon: Polygon | MultiPolygon): PointLocator {
  const parts = polygonParts(polygon).map(bandedPart);
  return (point: LatLon): PointLocation => {
    checkPoint(point);
    return locateInParts(parts, point, inBands);
  };
}
