/**
 * This module traces the boundary of an area on a grid of cells in longitude and latitude, with the method of marching
 * squares. A field has a value at each corner of the grid. The area is where the value is less than 0. `bufferKm` and
 * `gridRegion` use the tracer, each with its own field.
 *
 * @internal
 * @packageDocumentation
 */

import type { Position } from "./point.ts";
import { locateInRings } from "./planar.ts";
import { ringWinding } from "./polygon.ts";

/** The part of an edge of a cell at its two ends where no crossing goes. Thus no two crossings are equal. */
const END_GAP = 2 ** -10;

/** The frame of a grid: its box, and the count of the cells in longitude and in latitude. */
export interface ContourFrame {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
  readonly columns: number;
  readonly rows: number;
}

/** The values of the four corners of a cell, counterclockwise from its south-west corner. */
export type CellCorners = readonly [number, number, number, number];

/** The tracer of the boundary of one area. */
export interface ContourTracer {
  /**
   * This method adds the segments of the cell at the column `i` and the row `j`. A cell with four crossings gets the
   * value at its center from `centerOf`. Two inside corners on a diagonal join when the center is inside.
   */
  march(i: number, j: number, corners: CellCorners, centerOf: () => number): void;
  /**
   * This method gives the closed rings of the area. Each exterior ring goes counterclockwise, and each hole goes
   * clockwise. On the edge of the grid, a ring goes along the edge. When no boundary meets the edge of the grid,
   * `edgeInside` tells if the edge is in the area. Then the box of the grid is a ring too.
   */
  rings(edgeInside: () => boolean): Position[][];
}

/** A crossing of the boundary on the edge of the grid. */
interface BorderCrossing {
  readonly id: number;
  /** The place on the edge of the grid, counterclockwise from the south-west corner: 0 to 4. */
  readonly along: number;
  /** `true` when a segment starts at the crossing. Otherwise a segment ends at it. */
  readonly starts: boolean;
}

/** This function makes a tracer for a frame. The caller marches each cell that can hold a segment of the boundary. */
export function contourTracer(frame: ContourFrame): ContourTracer {
  const { west, east, south, north, columns, rows } = frame;
  const lonAt = (i: number): number => (i === columns ? east : west + (east - west) * (i / columns));
  const latAt = (j: number): number => (j === rows ? north : south + (north - south) * (j / rows));

  // The crossings: a horizontal edge from the corner (i, j) to (i + 1, j) has the id 2k, and a vertical edge from (i, j)
  // to (i, j + 1) has the id 2k + 1, with k the key of the corner (i, j).
  const positions = new Map<number, Position>();
  const next = new Map<number, number>();
  const border: BorderCrossing[] = [];
  const crossing = (horizontal: boolean, i: number, j: number, low: number, high: number, starts: boolean): number => {
    const id = 2 * (j * (columns + 1) + i) + (horizontal ? 0 : 1);
    if (!positions.has(id)) {
      const t = Math.min(1 - END_GAP, Math.max(END_GAP, low / (low - high)));
      const position: Position = horizontal
        ? [lonAt(i) + t * (lonAt(i + 1) - lonAt(i)), latAt(j)]
        : [lonAt(i), latAt(j) + t * (latAt(j + 1) - latAt(j))];
      positions.set(id, position);
      let along = -1;
      if (horizontal && j === 0) along = (i + t) / columns;
      else if (!horizontal && i === columns) along = 1 + (j + t) / rows;
      else if (horizontal && j === rows) along = 2 + (columns - i - t) / columns;
      else if (!horizontal && i === 0) along = 3 + (rows - j - t) / rows;
      if (along >= 0) border.push({ id, along, starts });
    }
    return id;
  };

  const march = (i: number, j: number, v: CellCorners, centerOf: () => number): void => {
    const isIn = v.map((value) => value < 0);
    // The edges of the cell, counterclockwise: each as [horizontal, i, j, the corner at the low end, the corner at the high end].
    const edges: readonly (readonly [boolean, number, number, number, number])[] = [
      [true, i, j, 0, 1],
      [false, i + 1, j, 1, 2],
      [true, i, j + 1, 3, 2],
      [false, i, j, 0, 3],
    ];
    const found: { readonly id: number; readonly out: boolean }[] = [];
    for (let k = 0; k < 4; k += 1) {
      const start = k;
      const end = (k + 1) % 4;
      if (isIn[start] === isIn[end]) continue;
      const [horizontal, ei, ej, lowCorner, highCorner] = edges[k] as readonly [boolean, number, number, number, number];
      // The boundary leaves the area where the edge goes from an inside corner to an outside corner, counterclockwise.
      const out = isIn[start] === true;
      found.push({ id: crossing(horizontal, ei, ej, v[lowCorner] as number, v[highCorner] as number, out), out });
    }
    const count = found.length;
    const joined = count === 4 && centerOf() < 0;
    for (let m = 0; m < count; m += 1) {
      const here = found[m] as { readonly id: number; readonly out: boolean };
      if (!here.out) continue;
      // Two inside corners on a diagonal: an inside center joins them, and an outside center keeps them apart.
      const partner = joined ? found[(m + 1) % count] : found[(m + count - 1) % count];
      next.set(here.id, (partner as { readonly id: number }).id);
    }
  };

  const rings = (edgeInside: () => boolean): Position[][] => {
    // On the edge of the grid, the boundary goes counterclockwise from each crossing where a segment ends to the next
    // crossing, where a segment starts. It goes through each corner of the grid between them.
    const gridCorners: readonly Position[] = [
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ];
    const along = new Map<number, Position[]>();
    border.sort((a, b) => a.along - b.along);
    border.forEach((here, index) => {
      if (here.starts) return;
      const there = border[(index + 1) % border.length] as BorderCrossing;
      if (!there.starts) throw new Error("contour: two crossings on the edge of the grid end segments one after the other");
      const end = there.along > here.along ? there.along : there.along + 4;
      const passed: Position[] = [];
      for (let q = 1; q <= 8; q += 1) if (q > here.along && q < end) passed.push(gridCorners[(q - 1) % 4] as Position);
      along.set(here.id, passed);
      next.set(here.id, there.id);
    });

    const result: Position[][] = [];
    const visited = new Set<number>();
    for (const start of next.keys()) {
      if (visited.has(start)) continue;
      const ring: Position[] = [];
      let id = start;
      do {
        visited.add(id);
        ring.push(positions.get(id) as Position);
        for (const corner of along.get(id) ?? []) ring.push(corner);
        const following = next.get(id);
        if (following === undefined) throw new Error("contour: a boundary of the contour does not close");
        id = following;
      } while (id !== start);
      result.push([...ring, ring[0] as Position]);
    }
    if (border.length === 0 && edgeInside()) {
      result.push([[west, south], [east, south], [east, north], [west, north], [west, south]]);
    }
    return result;
  };

  return { march, rings };
}

/** This function gives the signed area of a ring in the lon and lat plane, from its first position. */
function planeArea(ring: readonly Position[]): number {
  const [x0, y0] = ring[0] as Position;
  let sum = 0;
  for (let index = 1; index + 1 < ring.length; index += 1) {
    const a = ring[index] as Position;
    const b = ring[index + 1] as Position;
    sum += (a[0] - x0) * (b[1] - y0) - (b[0] - x0) * (a[1] - y0);
  }
  return sum / 2;
}

/** This function puts each hole into the smallest exterior ring around it. It gives the rings of each polygon. */
export function polygonsOf(rings: readonly Position[][]): Position[][][] {
  const exteriors: { readonly ring: Position[]; readonly area: number; readonly holes: Position[][] }[] = [];
  const holes: Position[][] = [];
  for (const ring of rings) {
    const winding = ringWinding(ring);
    if (winding === "counterclockwise") exteriors.push({ ring, area: Math.abs(planeArea(ring)), holes: [] });
    else if (winding === "clockwise") holes.push(ring);
  }
  for (const hole of holes) {
    let owner: (typeof exteriors)[number] | undefined;
    for (const exterior of exteriors) {
      if (owner !== undefined && exterior.area >= owner.area) continue;
      const [x, y] = hole[0] as Position;
      if (locateInRings([exterior.ring], x, y) === "inside") owner = exterior;
    }
    if (owner === undefined) throw new Error("contour: a hole has no exterior ring around it");
    owner.holes.push(hole);
  }
  return exteriors.map((exterior) => [exterior.ring, ...exterior.holes]);
}
