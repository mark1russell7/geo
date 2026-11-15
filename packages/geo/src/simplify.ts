/**
 * This module simplifies regions that share borders, for example the counties of a state, for a map at one zoom level.
 *
 * The rules:
 *
 * - A border that two regions share stays one border. The function removes the same positions from it in each
 *   region. Thus no gap and no overlap opens between the regions.
 * - Each removed position is at most the tolerance from the result, as `distanceToGeometryKm` measures it. Each
 *   position of the result is a position of the input.
 * - No edge of the result crosses another edge, and no kept position goes to the other side of a border. When a
 *   removal breaks this rule, the function keeps more positions.
 * - Each ring keeps 3 or more different positions. Thus no region and no hole goes out of the map.
 * - A ring of the result starts at the first position of the input ring when the function keeps that position.
 *
 * The method:
 *
 * - Equal positions join the regions. Thus two regions that share a border must have the same positions on it.
 * - A junction is a position where the neighbors of a ring change, for example where three regions meet. The
 *   function keeps each junction, and it cuts each ring at its junctions into arcs. A ring with no junction is one arc.
 * - The method of Douglas and Peucker simplifies each arc one time, so each region gets the same border. It measures
 *   each distance on the sphere, to an edge that is a straight line in longitude and latitude (RFC 7946).
 * - The tests of the crossings use the exact predicates in the plane of the longitudes as written. Thus write all
 *   the regions in one range of longitudes, for example -180 to 180.
 *
 * @packageDocumentation
 */

import { classifySegments, orient2dSign } from "@mark1russell7/predicates";
import { angleToEdge, angleToPosition, scale, viewerAt, type Viewer } from "./distance.ts";
import { GeoError } from "./errors.ts";
import { checkGeometry, type MultiPolygon, type Polygon } from "./geojson.ts";
import { locateInRings } from "@mark1russell7/predicates";
import { checkGeometryLongitudes } from "./planar.ts";
import type { Position } from "./point.ts";
import { checkRadius, EARTH_MEAN_RADIUS_KM } from "./sphere.ts";

/** A region of a map: a GeoJSON Polygon or MultiPolygon. */
export type Region = Polygon | MultiPolygon;

/**
 * An arc: the positions from a junction to the next junction, or a full ring with no junction. The tree of the method
 * of Douglas and Peucker is in the arrays. A node is the index of an inner position.
 */
interface Arc {
  readonly positions: readonly Position[];
  /** The angle in radians from each inner position to the edge of its span. */
  readonly angles: Float64Array;
  /** The node that splits the span from the start of the span of a node to that node, or -1. */
  readonly left: Int32Array;
  /** The node that splits the span from a node to the end of the span of that node, or -1. */
  readonly right: Int32Array;
  /** The node that splits the full arc, or -1 when the arc has no inner position. */
  readonly root: number;
}

/** A reference to an arc: the index for the arc in its direction, and `~index` for the other direction. */
type ArcRef = number;

/** A ring of the topology: its arcs, or the ring as written when it has fewer than 3 different positions. */
type TopologyRing = { readonly arcs: readonly ArcRef[]; readonly first: string } | { readonly fixed: readonly Position[] };

interface TopologyRegion {
  readonly type: Region["type"];
  readonly polygons: readonly (readonly TopologyRing[])[];
}

interface Topology {
  readonly arcs: readonly Arc[];
  readonly regions: readonly TopologyRegion[];
}

const keyOf = (position: Position): string => `${position[0]},${position[1]}`;

const samePosition = (a: Position, b: Position): boolean => a[0] === b[0] && a[1] === b[1];

/** This function gives `true` when the position `a` comes before the position `b`, by longitude and then by latitude. */
const comesBefore = (a: Position, b: Position): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

const arcIndex = (ref: ArcRef): number => (ref < 0 ? ~ref : ref);

/** This function gives the polygons of a region. */
const polygonsOf = (region: Region): readonly (readonly (readonly Position[])[])[] =>
  region.type === "Polygon" ? [region.coordinates] : region.coordinates;

/** This function refuses a list of regions that is not valid. */
function checkRegions(regions: readonly Region[]): void {
  if (!Array.isArray(regions)) throw new GeoError("geojson-member", "The regions must be an array");
  regions.forEach((region: unknown, index) => {
    const path = `[${index}]`;
    checkGeometry(region, path);
    const geometry = region as { readonly type: string };
    if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
      throw new GeoError("geojson-type", `A region must be a Polygon or a MultiPolygon, not a ${geometry.type}`, path);
    }
    const valid = region as Region;
    polygonsOf(valid).forEach((rings, polygon) => {
      const base = valid.type === "Polygon" ? `${path}.coordinates` : `${path}.coordinates[${polygon}]`;
      rings.forEach((ring, ringIndex) => checkGeometryLongitudes(ring, `${base}[${ringIndex}]`));
    });
  });
}

/** This function refuses a tolerance that is not finite or that is less than 0. */
function checkTolerance(toleranceKm: number): void {
  if (!Number.isFinite(toleranceKm)) throw new GeoError("not-finite", `The tolerance ${toleranceKm} is not a finite number`);
  if (toleranceKm < 0) throw new GeoError("tolerance", `The tolerance ${toleranceKm} must be 0 or more`);
}

/** This function gives the positions of a ring with no closing position and no position equal to the one before it. */
function openRing(ring: readonly Position[]): Position[] {
  const positions: Position[] = [];
  for (const position of ring.slice(0, -1)) {
    const last = positions[positions.length - 1];
    if (last === undefined || !samePosition(last, position)) positions.push(position);
  }
  while (positions.length > 1 && samePosition(positions[0] as Position, positions[positions.length - 1] as Position)) {
    positions.pop();
  }
  return positions;
}

/**
 * This function gives the junctions of the rings. A position is a junction when two of its occurrences have different
 * neighbors. The neighbors of an occurrence are the positions before and after it, in any order.
 */
function findJunctions(rings: readonly (readonly string[])[]): Set<string> {
  const neighbors = new Map<string, string>();
  const junctions = new Set<string>();
  for (const keys of rings) {
    keys.forEach((key, index) => {
      const previous = keys[(index + keys.length - 1) % keys.length] as string;
      const next = keys[(index + 1) % keys.length] as string;
      const pair = previous < next ? `${previous} ${next}` : `${next} ${previous}`;
      const seen = neighbors.get(key);
      if (seen === undefined) neighbors.set(key, pair);
      else if (seen !== pair) junctions.add(key);
    });
  }
  return junctions;
}

/**
 * This function cuts an open ring into arcs at its junctions. A ring with no junction becomes one closed arc. That arc
 * starts at the first of its positions by longitude and then by latitude, so each ring with these positions gives it.
 */
function cutRing(ring: readonly Position[], keys: readonly string[], junctions: ReadonlySet<string>): Position[][] {
  const start = keys.findIndex((key) => junctions.has(key));
  if (start < 0) {
    let first = 0;
    ring.forEach((position, index) => {
      if (comesBefore(position, ring[first] as Position)) first = index;
    });
    const rotated = [...ring.slice(first), ...ring.slice(0, first)];
    return [[...rotated, rotated[0] as Position]];
  }
  const arcs: Position[][] = [];
  let current: Position[] = [ring[start] as Position];
  for (let step = 1; step <= ring.length; step += 1) {
    const index = (start + step) % ring.length;
    const position = ring[index] as Position;
    current.push(position);
    if (junctions.has(keys[index] as string)) {
      arcs.push(current);
      current = [position];
    }
  }
  return arcs;
}

/** This function gives `true` when the position is on the closed segment from `a` to `b`, with no rounding. */
function onSegment(position: Position, a: Position, b: Position): boolean {
  const [x, y] = position;
  if (x < Math.min(a[0], b[0]) || x > Math.max(a[0], b[0]) || y < Math.min(a[1], b[1]) || y > Math.max(a[1], b[1])) {
    return false;
  }
  return orient2dSign(a[0], a[1], b[0], b[1], x, y) === 0;
}

/**
 * This function gives the central angle from a position to the edge from `a` to `b`. The angle is 0 only when the
 * position is on the edge, as for `distanceToGeometryKm`.
 */
function edgeAngle(viewer: Viewer, position: Position, a: Position, b: Position): number {
  if (onSegment(position, a, b)) return 0;
  return Math.max(Number.MIN_VALUE, angleToEdge(viewer, a, b));
}

/** This function gives the inner position of the span from `i` to `j` that is farthest from the edge of the span. */
function farthest(positions: readonly Position[], i: number, j: number): { readonly node: number; readonly angle: number } {
  const a = positions[i] as Position;
  const b = positions[j] as Position;
  let node = -1;
  let best = -1;
  for (let k = i + 1; k < j; k += 1) {
    const position = positions[k] as Position;
    const viewer = viewerAt(position);
    // The angle to the edge is not more than the angle to its nearer end. This bound skips most positions.
    const bound = Math.max(Number.MIN_VALUE, Math.min(angleToPosition(viewer, a), angleToPosition(viewer, b)));
    if (bound <= best) continue;
    const angle = edgeAngle(viewer, position, a, b);
    if (angle > best) {
      node = k;
      best = angle;
    }
  }
  return { node, angle: best };
}

/** This function makes the tree of the method of Douglas and Peucker for an arc. */
function arcOf(positions: readonly Position[]): Arc {
  const count = positions.length;
  const angles = new Float64Array(count);
  const left = new Int32Array(count).fill(-1);
  const right = new Int32Array(count).fill(-1);
  let root = -1;
  // Each entry is a span from i to j, its parent node and its side: 0 for left and 1 for right. The root has no parent.
  const stack: number[] = [0, count - 1, -1, 0];
  while (stack.length > 0) {
    const side = stack.pop() as number;
    const parent = stack.pop() as number;
    const j = stack.pop() as number;
    const i = stack.pop() as number;
    if (j - i < 2) continue;
    const { node, angle } = farthest(positions, i, j);
    angles[node] = angle;
    if (parent < 0) root = node;
    else if (side === 0) left[parent] = node;
    else right[parent] = node;
    stack.push(i, node, node, 0, node, j, node, 1);
  }
  return { positions, angles, left, right, root };
}

/** This function makes the topology of valid regions: the shared arcs and the rings of each region. */
function topologyOf(regions: readonly Region[]): Topology {
  const opened = regions.map((region) => polygonsOf(region).map((rings) => rings.map(openRing)));
  const usable = (ring: readonly Position[]): boolean => new Set(ring.map(keyOf)).size >= 3;
  const keyed = new Map<readonly Position[], string[]>();
  for (const ring of opened.flat(2)) if (usable(ring)) keyed.set(ring, ring.map(keyOf));
  const junctions = findJunctions([...keyed.values()]);
  const arcs: Arc[] = [];
  const indexes = new Map<string, number>();
  const refOf = (positions: Position[]): ArcRef => {
    const keys = positions.map(keyOf);
    const forward = keys.join(" ");
    const backward = keys.reverse().join(" ");
    const canonical = forward <= backward;
    const key = canonical ? forward : backward;
    let index = indexes.get(key);
    if (index === undefined) {
      index = arcs.length;
      arcs.push(arcOf(canonical ? positions : [...positions].reverse()));
      indexes.set(key, index);
    }
    return canonical ? index : ~index;
  };
  const topologyRegions = regions.map((region, regionIndex): TopologyRegion => ({
    type: region.type,
    polygons: polygonsOf(region).map((rings, polygonIndex) =>
      rings.map((ring, ringIndex): TopologyRing => {
        const open = opened[regionIndex]?.[polygonIndex]?.[ringIndex] as Position[];
        const keys = keyed.get(open);
        if (keys === undefined) return { fixed: ring };
        return { arcs: cutRing(open, keys, junctions).map(refOf), first: keys[0] as string };
      }),
    ),
  }));
  return { arcs, regions: topologyRegions };
}

/** The positions that a simplification keeps, for each arc. */
interface Selection {
  readonly topology: Topology;
  readonly toleranceKm: number;
  readonly radiusKm: number;
  /** For each arc, a flag for each node that a repair keeps. */
  readonly forced: readonly Uint8Array[];
  /** For each arc, the indexes of the kept positions, in order. */
  readonly kept: number[][];
}

/**
 * This function gives the indexes of the kept positions of an arc, in order. A node is kept when a repair keeps it or
 * its angle is more than the tolerance, and its parent is kept. The ends are kept.
 */
function keptOf(arc: Arc, forced: Uint8Array, toleranceKm: number, radiusKm: number): number[] {
  const keeps = (node: number): boolean =>
    node >= 0 && (forced[node] === 1 || scale(arc.angles[node] as number, radiusKm) > toleranceKm);
  const kept = [0];
  const stack: number[] = [];
  let current = keeps(arc.root) ? arc.root : -1;
  while (current >= 0 || stack.length > 0) {
    while (current >= 0) {
      stack.push(current);
      const next = arc.left[current] as number;
      current = keeps(next) ? next : -1;
    }
    const node = stack.pop() as number;
    kept.push(node);
    const next = arc.right[node] as number;
    current = keeps(next) ? next : -1;
  }
  kept.push(arc.positions.length - 1);
  return kept;
}

/**
 * This function gives the node of the span from `i` to `j`, two kept positions with no kept position between them.
 * That node is the right child of `i`, the left child of `j`, or the root. The result is -1 for an edge of the input.
 */
function spanNode(arc: Arc, i: number, j: number): number {
  for (const node of [arc.right[i] ?? -1, arc.left[j] ?? -1, arc.root]) if (node > i && node < j) return node;
  return -1;
}

/** This function keeps a node of an arc. It gives `false` when the node is kept already. */
function force(selection: Selection, arc: number, node: number): boolean {
  const flags = selection.forced[arc] as Uint8Array;
  if (flags[node] === 1) return false;
  flags[node] = 1;
  return true;
}

function refresh(selection: Selection, arc: number): void {
  const { topology, forced, toleranceKm, radiusKm } = selection;
  selection.kept[arc] = keptOf(topology.arcs[arc] as Arc, forced[arc] as Uint8Array, toleranceKm, radiusKm);
}

/** This function keeps more positions until each ring has 3 or more different positions. */
function keepRingsOpen(selection: Selection): void {
  const { topology, kept } = selection;
  for (const region of topology.regions) {
    for (const ring of region.polygons.flat()) {
      if (!("arcs" in ring)) continue;
      for (;;) {
        const keys = new Set<string>();
        let bestArc = -1;
        let bestNode = -1;
        let bestAngle = -1;
        for (const ref of ring.arcs) {
          const index = arcIndex(ref);
          const arc = topology.arcs[index] as Arc;
          const indexes = kept[index] as number[];
          for (const k of indexes) keys.add(keyOf(arc.positions[k] as Position));
          for (let t = 0; t + 1 < indexes.length; t += 1) {
            const node = spanNode(arc, indexes[t] as number, indexes[t + 1] as number);
            if (node >= 0 && (arc.angles[node] as number) > bestAngle) {
              bestArc = index;
              bestNode = node;
              bestAngle = arc.angles[node] as number;
            }
          }
        }
        if (keys.size >= 3 || bestNode < 0) break;
        force(selection, bestArc, bestNode);
        refresh(selection, bestArc);
      }
    }
  }
}

/** A uniform grid of cells over a box, for the search of near segments and positions. */
class Grid {
  readonly cells = new Map<number, number[]>();
  readonly #minX: number;
  readonly #minY: number;
  readonly #width: number;
  readonly #height: number;
  readonly #side: number;

  constructor(minX: number, minY: number, maxX: number, maxY: number, count: number) {
    this.#side = Math.max(1, Math.ceil(Math.sqrt(count)));
    this.#minX = minX;
    this.#minY = minY;
    const width = (maxX - minX) / this.#side;
    const height = (maxY - minY) / this.#side;
    this.#width = width > 0 && Number.isFinite(width) ? width : 1;
    this.#height = height > 0 && Number.isFinite(height) ? height : 1;
  }

  /** This function gives the column of a longitude. It does not decrease when the longitude increases. */
  column(x: number): number {
    return Math.min(this.#side - 1, Math.max(0, Math.floor((x - this.#minX) / this.#width)));
  }

  /** This function gives the row of a latitude. It does not decrease when the latitude increases. */
  row(y: number): number {
    return Math.min(this.#side - 1, Math.max(0, Math.floor((y - this.#minY) / this.#height)));
  }

  cell(x: number, y: number): number {
    return this.row(y) * this.#side + this.column(x);
  }

  add(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
    for (let row = this.row(minY); row <= this.row(maxY); row += 1) {
      for (let column = this.column(minX); column <= this.column(maxX); column += 1) {
        const key = row * this.#side + column;
        const ids = this.cells.get(key);
        if (ids === undefined) this.cells.set(key, [id]);
        else ids.push(id);
      }
    }
  }

  /** This function gives each id in the cells of the box to `visit`. An id in two cells comes two times. */
  visit(minX: number, minY: number, maxX: number, maxY: number, visit: (id: number) => boolean): void {
    for (let row = this.row(minY); row <= this.row(maxY); row += 1) {
      for (let column = this.column(minX); column <= this.column(maxX); column += 1) {
        for (const id of this.cells.get(row * this.#side + column) ?? []) if (visit(id)) return;
      }
    }
  }
}

/** The kept edges of all arcs, in arrays. */
interface Edges {
  readonly arc: number[];
  readonly from: number[];
  readonly to: number[];
  readonly a: Position[];
  readonly b: Position[];
}

function edgesOf(selection: Selection): Edges {
  const edges: Edges = { arc: [], from: [], to: [], a: [], b: [] };
  selection.kept.forEach((indexes, arc) => {
    const positions = (selection.topology.arcs[arc] as Arc).positions;
    for (let t = 0; t + 1 < indexes.length; t += 1) {
      const from = indexes[t] as number;
      const to = indexes[t + 1] as number;
      edges.arc.push(arc);
      edges.from.push(from);
      edges.to.push(to);
      edges.a.push(positions[from] as Position);
      edges.b.push(positions[to] as Position);
    }
  });
  return edges;
}

/** This function gives `true` when two edges meet only at a shared end, or do not meet. */
function edgesFit(a: Position, b: Position, c: Position, d: Position): boolean {
  const { relation } = classifySegments(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
  if (relation === "disjoint") return true;
  if (relation !== "touch") return false;
  return samePosition(a, c) || samePosition(a, d) || samePosition(b, c) || samePosition(b, d);
}

/**
 * This function gives the edges that break the topology:
 *
 * - Two edges that cross, that overlap, or that touch at a point that is not a shared end.
 * - An edge that removes positions, with a kept position inside its lobe. The lobe is the ring of the removed
 *   positions and the edge. A kept position inside it went to the other side of the arc.
 */
function badEdges(selection: Selection, edges: Edges): Set<number> {
  const count = edges.arc.length;
  const bad = new Set<number>();
  // The kept positions: the two ends of each edge. A junction comes more than one time.
  const points = [...edges.a, ...edges.b];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const position of points) {
    minX = Math.min(minX, position[0]);
    minY = Math.min(minY, position[1]);
    maxX = Math.max(maxX, position[0]);
    maxY = Math.max(maxY, position[1]);
  }
  if (count === 0) return bad;
  const grid = new Grid(minX, minY, maxX, maxY, count);
  for (let edge = 0; edge < count; edge += 1) {
    const a = edges.a[edge] as Position;
    const b = edges.b[edge] as Position;
    grid.add(edge, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
  }
  const vertices = new Grid(minX, minY, maxX, maxY, count);
  points.forEach(([x, y], id) => vertices.add(id, x, y, x, y));
  for (const [cell, ids] of grid.cells) {
    for (let s = 0; s < ids.length; s += 1) {
      for (let t = s + 1; t < ids.length; t += 1) {
        const first = ids[s] as number;
        const second = ids[t] as number;
        const a = edges.a[first] as Position;
        const b = edges.b[first] as Position;
        const c = edges.a[second] as Position;
        const d = edges.b[second] as Position;
        const left = Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
        const bottom = Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
        if (left > Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0]))) continue;
        if (bottom > Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]))) continue;
        // Each pair of edges is tested in one cell only: the cell of the low corner of the box that they share.
        if (grid.cell(left, bottom) !== cell) continue;
        if (!edgesFit(a, b, c, d)) {
          bad.add(first);
          bad.add(second);
        }
      }
    }
  }
  for (let edge = 0; edge < count; edge += 1) {
    const from = edges.from[edge] as number;
    const to = edges.to[edge] as number;
    if (to - from < 2) continue;
    const positions = (selection.topology.arcs[edges.arc[edge] as number] as Arc).positions;
    const lobe = [...positions.slice(from, to + 1), positions[from] as Position];
    let lowX = Number.POSITIVE_INFINITY;
    let lowY = Number.POSITIVE_INFINITY;
    let highX = Number.NEGATIVE_INFINITY;
    let highY = Number.NEGATIVE_INFINITY;
    for (const [x, y] of lobe) {
      lowX = Math.min(lowX, x);
      lowY = Math.min(lowY, y);
      highX = Math.max(highX, x);
      highY = Math.max(highY, y);
    }
    vertices.visit(lowX, lowY, highX, highY, (other) => {
      const [x, y] = points[other] as Position;
      if (x < lowX || x > highX || y < lowY || y > highY) return false;
      if (locateInRings([lobe], x, y) !== "inside") return false;
      bad.add(edge);
      return true;
    });
  }
  return bad;
}

/** This function keeps more positions until no edge breaks the topology, or until no edge can change. */
function repair(selection: Selection): void {
  for (;;) {
    const edges = edgesOf(selection);
    const changed = new Set<number>();
    for (const edge of badEdges(selection, edges)) {
      const arc = edges.arc[edge] as number;
      const node = spanNode(selection.topology.arcs[arc] as Arc, edges.from[edge] as number, edges.to[edge] as number);
      if (node >= 0 && force(selection, arc, node)) changed.add(arc);
    }
    if (changed.size === 0) return;
    for (const arc of changed) refresh(selection, arc);
  }
}

/** This function gives the closed ring of the kept positions of a ring of the topology. */
function ringOf(selection: Selection, ring: TopologyRing): Position[] {
  if ("fixed" in ring) return [...ring.fixed];
  const positions: Position[] = [];
  for (const ref of ring.arcs) {
    const index = arcIndex(ref);
    const arc = (selection.topology.arcs[index] as Arc).positions;
    const indexes = selection.kept[index] as number[];
    const order = ref < 0 ? [...indexes].reverse() : indexes;
    for (const k of order.slice(positions.length === 0 ? 0 : 1)) positions.push(arc[k] as Position);
  }
  // The ring starts at the first position of the input ring when that position is kept.
  const start = positions.findIndex((position) => keyOf(position) === ring.first);
  if (start <= 0) return positions;
  const open = positions.slice(0, -1);
  const rotated = [...open.slice(start), ...open.slice(0, start)];
  return [...rotated, rotated[0] as Position];
}

function simplifyTopology(topology: Topology, toleranceKm: number, radiusKm: number): Region[] {
  const forced = topology.arcs.map((arc) => new Uint8Array(arc.positions.length));
  const kept = topology.arcs.map((arc, index) => keptOf(arc, forced[index] as Uint8Array, toleranceKm, radiusKm));
  const selection: Selection = { topology, toleranceKm, radiusKm, forced, kept };
  keepRingsOpen(selection);
  repair(selection);
  return topology.regions.map((region): Region => {
    const polygons = region.polygons.map((rings) => rings.map((ring) => ringOf(selection, ring)));
    return region.type === "Polygon"
      ? { type: "Polygon", coordinates: polygons[0] ?? [] }
      : { type: "MultiPolygon", coordinates: polygons };
  });
}

/**
 * This function prepares the simplification of regions that share borders. It gives a function that simplifies the
 * regions for one tolerance. Thus a map makes the shared arcs one time and simplifies them for each zoom level.
 *
 * The description of `simplifyRegions` gives the rules. The function keeps the positions of the input, so do not change
 * the input after this call.
 *
 * @param regions - The Polygons and MultiPolygons. Regions that share a border must have equal positions on it.
 * @param radiusKm - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_KM`.
 * @returns A function that gives the simplified regions for a tolerance in kilometres. That tolerance is 0 or more.
 * @throws GeoError - The codes of `parseGeometry`, `geojson-type` for another geometry, `longitude-range` and `radius`.
 *   The function that this function gives throws `not-finite` and `tolerance`.
 */
export function regionSimplifier(
  regions: readonly Region[],
  radiusKm: number = EARTH_MEAN_RADIUS_KM,
): (toleranceKm: number) => Region[] {
  checkRadius(radiusKm);
  checkRegions(regions);
  const topology = topologyOf(regions);
  return (toleranceKm: number): Region[] => {
    checkTolerance(toleranceKm);
    return simplifyTopology(topology, toleranceKm, radiusKm);
  };
}

/**
 * This function simplifies regions that share borders, for example the counties of a state, with the method of Douglas
 * and Peucker. It gives one region for each region of the input, with the same type.
 *
 * - Each removed position is at most `toleranceKm` from the result, as `distanceToGeometryKm` measures it.
 * - A border that two regions share stays one border, so no gap and no overlap opens.
 * - No edge of the result crosses another edge. Each ring keeps 3 or more different positions.
 * - Equal positions join the regions. A position of one region on an edge of another region does not join them.
 * - The tests of the crossings use the longitudes as written. Thus write all the regions in one range of longitudes.
 *
 * @param regions - The Polygons and MultiPolygons. Regions that share a border must have equal positions on it.
 * @param toleranceKm - The largest distance in kilometres from a removed position to the result, 0 or more.
 * @param radiusKm - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_KM`.
 * @throws GeoError - The codes of `regionSimplifier`, `not-finite` and `tolerance`.
 */
export function simplifyRegions(
  regions: readonly Region[],
  toleranceKm: number,
  radiusKm: number = EARTH_MEAN_RADIUS_KM,
): Region[] {
  checkTolerance(toleranceKm);
  return regionSimplifier(regions, radiusKm)(toleranceKm);
}
