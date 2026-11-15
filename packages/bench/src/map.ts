/**
 * This module makes seeded maps of regions that share borders, for the bench of `simplifyRegions`. No real map data
 * goes into the repository.
 *
 * The shape of a map:
 *
 * - The regions are the cells of a grid in a box of 10 by 10.5 degrees at the latitudes of Texas. Each inner corner
 *   of the grid moves by up to 15 % of a cell, so the cells are not rectangles.
 * - Each border between two corners is one list of positions. The two regions of a border use the same positions, in
 *   the two directions. Thus the junctions are the corners.
 * - The outer borders are coasts, with the most positions. An inner border is a straight line with few positions
 *   (35 %), or a river.
 * - A coast or a river is a rough curve: the graph of a function over its chord. A midpoint displacement with the
 *   Hurst exponent 0.75 makes the function. The curve stays in a rhombus on its chord with a half angle of 16 degrees.
 * - The rhombi of two borders meet only at a shared corner, so no edge crosses another edge.
 * - Each value has 6 decimals, as in usual GeoJSON data.
 *
 * @packageDocumentation
 */

import type { Polygon, Position } from "@mark1russell7/geo";
import { random, type Random } from "@mark1russell7/rigor-generators";

/** A case of the bench: a grid of regions and the target count of positions. */
export interface MapSpec {
  readonly id: string;
  readonly columns: number;
  readonly rows: number;
  /** The target count of positions over all rings, with the closing position of each ring. */
  readonly positions: number;
}

/**
 * The cases of the bench. The case `tx-552-325k` has the size of the NWS regions of Texas: 552 regions and
 * approximately 325,000 positions.
 */
export const CASES: readonly MapSpec[] = [
  { id: "grid-30-1e3", columns: 6, rows: 5, positions: 1_000 },
  { id: "grid-100-1e4", columns: 10, rows: 10, positions: 10_000 },
  { id: "grid-552-1e5", columns: 24, rows: 23, positions: 100_000 },
  { id: "tx-552-325k", columns: 24, rows: 23, positions: 325_000 },
  { id: "grid-552-1e6", columns: 24, rows: 23, positions: 1_000_000 },
];

/** The tolerance of the bench in kilometres: a map of a state at the zoom of its counties. */
export const TOLERANCE_KM = 1;

/** This function gives the case with the id, or a `RangeError`. */
export function caseOf(id: string): MapSpec {
  const found = CASES.find((spec) => spec.id === id);
  if (found === undefined) throw new RangeError(`There is no case ${id}. The cases: ${CASES.map((spec) => spec.id).join(", ")}`);
  return found;
}

const WEST = -104;
const EAST = -94;
const SOUTH = 26;
const NORTH = 36.5;
/** The largest move of an inner corner, as a part of a cell. */
const CORNER_MOVE = 0.15;
/** The tangent of the half angle of the rhombus of a border: tan(16 degrees). */
const RHOMBUS = 0.2867;
const HURST = 0.75;
/** The size of the displacement, as a part of the chord. */
const ROUGHNESS = 0.15;
const LINE_SHARE = 0.35;
const COAST_WEIGHT = 4;

type Kind = "line" | "river" | "coast";

interface Border {
  readonly from: Position;
  readonly to: Position;
  readonly kind: Kind;
  /** 1 for an outer border, and 2 for an inner border: the count of rings that have its positions. */
  readonly rings: number;
  readonly draw: Random;
  readonly weight: number;
  inner: number;
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/** This function gives the inner positions of a border, from `from` to `to`. */
function innerOf(border: Border): Position[] {
  const { from, to, inner: count, draw, kind } = border;
  if (count === 0) return [];
  const s = new Float64Array(count + 2);
  const d = new Float64Array(count + 2);
  s[count + 1] = 1;
  for (let index = 1; index <= count; index += 1) s[index] = (index + draw.range(-0.3, 0.3)) / (count + 1);
  if (kind !== "line") {
    // The midpoint displacement over the indexes, with an explicit stack.
    const stack: number[] = [0, count + 1];
    while (stack.length > 0) {
      const high = stack.pop() as number;
      const low = stack.pop() as number;
      if (high - low < 2) continue;
      const middle = (low + high) >> 1;
      const span = (s[high] as number) - (s[low] as number);
      d[middle] = ((d[low] as number) + (d[high] as number)) / 2 + ROUGHNESS * span ** HURST * draw.range(-1, 1);
      stack.push(low, middle, middle, high);
    }
  }
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const positions: Position[] = [];
  for (let index = 1; index <= count; index += 1) {
    const along = s[index] as number;
    const limit = RHOMBUS * Math.min(along, 1 - along);
    const across = Math.max(-limit, Math.min(limit, d[index] as number));
    // The normal of the chord is (-dy, dx). The length of the chord scales `across`.
    positions.push([round6(from[0] + along * dx - across * dy), round6(from[1] + along * dy + across * dx)]);
  }
  return positions;
}

/** This function gives the regions of a case: one Polygon for each cell, with its ring counterclockwise. */
export function mapOf(spec: MapSpec): Polygon[] {
  const { columns, rows } = spec;
  const root = random(`geo-bench:${spec.id}`);
  const width = (EAST - WEST) / columns;
  const height = (NORTH - SOUTH) / rows;
  const corners: Position[][] = [];
  for (let c = 0; c <= columns; c += 1) {
    const column: Position[] = [];
    for (let r = 0; r <= rows; r += 1) {
      const draw = root.fork(`corner:${c}:${r}`);
      const moveX = c > 0 && c < columns ? draw.range(-CORNER_MOVE, CORNER_MOVE) * width : 0;
      const moveY = r > 0 && r < rows ? draw.range(-CORNER_MOVE, CORNER_MOVE) * height : 0;
      column.push([round6(WEST + c * width + moveX), round6(SOUTH + r * height + moveY)]);
    }
    corners.push(column);
  }
  const corner = (c: number, r: number): Position => corners[c]?.[r] as Position;
  const border = (key: string, from: Position, to: Position, outer: boolean): Border => {
    const draw = root.fork(key);
    const kind: Kind = outer ? "coast" : draw.chance(LINE_SHARE) ? "line" : "river";
    const weight = kind === "line" ? 0 : Math.exp(0.8 * draw.normal()) * (kind === "coast" ? COAST_WEIGHT : 1);
    return { from, to, kind, rings: outer ? 1 : 2, draw, weight, inner: kind === "line" ? draw.int(0, 3) : 0 };
  };
  // The border h[c][r] goes from the corner (c, r) to the corner (c + 1, r). The border v[c][r] goes from (c, r) to (c, r + 1).
  const h: Border[][] = [];
  const v: Border[][] = [];
  for (let c = 0; c < columns; c += 1) {
    h.push(Array.from({ length: rows + 1 }, (_, r) => border(`h:${c}:${r}`, corner(c, r), corner(c + 1, r), r === 0 || r === rows)));
  }
  for (let c = 0; c <= columns; c += 1) {
    v.push(Array.from({ length: rows }, (_, r) => border(`v:${c}:${r}`, corner(c, r), corner(c, r + 1), c === 0 || c === columns)));
  }
  const all = [...h.flat(), ...v.flat()];
  // Each ring has its 4 corners and a closing position. The rest of the positions go to the curves, by weight.
  const fixed = 5 * columns * rows + all.reduce((sum, b) => sum + b.rings * b.inner, 0);
  const budget = Math.max(0, spec.positions - fixed);
  const total = all.reduce((sum, b) => sum + b.rings * b.weight, 0);
  for (const b of all) if (b.kind !== "line") b.inner = Math.round((budget * b.weight) / total);
  const inner = new Map<Border, Position[]>(all.map((b) => [b, innerOf(b)]));
  const forward = (b: Border): Position[] => inner.get(b) as Position[];
  const backward = (b: Border): Position[] => [...(inner.get(b) as Position[])].reverse();
  const regions: Polygon[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const ring: Position[] = [
        corner(c, r),
        ...forward(h[c]?.[r] as Border),
        corner(c + 1, r),
        ...forward(v[c + 1]?.[r] as Border),
        corner(c + 1, r + 1),
        ...backward(h[c]?.[r + 1] as Border),
        corner(c, r + 1),
        ...backward(v[c]?.[r] as Border),
        corner(c, r),
      ];
      regions.push({ type: "Polygon", coordinates: [ring] });
    }
  }
  return regions;
}

/** This function gives the count of positions over all rings of the regions, with the closing positions. */
export function positionCount(regions: readonly Polygon[]): number {
  return regions.reduce((sum, region) => sum + region.coordinates.reduce((count, ring) => count + ring.length, 0), 0);
}
