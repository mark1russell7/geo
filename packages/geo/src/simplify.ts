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
import { angleBoundToEdge, angleToEdge, scale, viewerAt, type Viewer } from "./distance.ts";
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
 *
 * The tree grows when a simplification reads it: a span gets its node at the first read. Thus a large tolerance makes
 * only the top of the tree, and the next tolerance uses the nodes that are made.
 */
interface Arc {
  readonly positions: readonly Position[];
  /** The angle in radians from each node to the edge of its span. */
  readonly angles: Float64Array;
  /** The node that splits the span from the start of the span of a node to that node, -1, or `UNMADE`. */
  readonly left: Int32Array;
  /** The node that splits the span from a node to the end of the span of that node, -1, or `UNMADE`. */
  readonly right: Int32Array;
  /** The start of the span of each node. */
  readonly starts: Int32Array;
  /** The end of the span of each node. */
  readonly ends: Int32Array;
  /** The node that splits the full arc, -1 when the arc has no inner position, or `UNMADE`. */
  root: number;
}

/** The value of a child or of the root that is not made yet. */
const UNMADE = -2;

/** A reference to an arc: the index for the arc in its direction, and `~index` for the other direction. */
type ArcRef = number;

/** A ring of the topology: its arcs, or the ring as written when it has fewer than 3 different positions. */
type TopologyRing = { readonly arcs: readonly ArcRef[]; readonly first: Position } | { readonly fixed: readonly Position[] };

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

/** This function gives `true` when the ids have 3 or more different values. */
function hasThreeDifferent(ids: Int32Array): boolean {
  const first = ids[0];
  let second = -1;
  for (const id of ids) {
    if (id === first) continue;
    if (second < 0) second = id;
    else if (id !== second) return true;
  }
  return false;
}

/**
 * This function gives a flag for each position id: 1 when the position is a junction. A position is a junction when two
 * of its occurrences have different neighbors. The neighbors of an occurrence are the positions before and after it, in
 * any order.
 */
function findJunctions(rings: readonly Int32Array[], count: number): Uint8Array {
  const low = new Int32Array(count).fill(-1);
  const high = new Int32Array(count);
  const junctions = new Uint8Array(count);
  for (const ids of rings) {
    const length = ids.length;
    for (let index = 0; index < length; index += 1) {
      const id = ids[index] as number;
      const previous = ids[(index + length - 1) % length] as number;
      const next = ids[(index + 1) % length] as number;
      const first = Math.min(previous, next);
      const second = Math.max(previous, next);
      if (low[id] === -1) {
        low[id] = first;
        high[id] = second;
      } else if (low[id] !== first || high[id] !== second) {
        junctions[id] = 1;
      }
    }
  }
  return junctions;
}

/**
 * This function cuts an open ring into arcs at its junctions. It gives the indexes in the ring of the positions of each
 * arc. A ring with no junction becomes one closed arc. That arc starts at the first of its positions by longitude and
 * then by latitude, so each ring with these positions gives it.
 */
function cutRing(ring: readonly Position[], ids: Int32Array, junctions: Uint8Array): number[][] {
  const count = ring.length;
  const start = ids.findIndex((id) => junctions[id] === 1);
  if (start < 0) {
    let first = 0;
    ring.forEach((position, index) => {
      if (comesBefore(position, ring[first] as Position)) first = index;
    });
    const order = Array.from({ length: count }, (_, step) => (first + step) % count);
    return [[...order, first]];
  }
  const arcs: number[][] = [];
  let current = [start];
  for (let step = 1; step <= count; step += 1) {
    const index = (start + step) % count;
    current.push(index);
    if (junctions[ids[index] as number] === 1) {
      arcs.push(current);
      current = [index];
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

/** The bounds of the positions of a span, for `farthest`. Each span uses this array, and it grows for a long arc. */
let scratch = new Float64Array(64);

/**
 * This function gives the inner position of the span from `i` to `j` that is farthest from the edge of the span. Of
 * two positions with the same angle, the first wins.
 */
function farthest(positions: readonly Position[], i: number, j: number): { readonly node: number; readonly angle: number } {
  const a = positions[i] as Position;
  const b = positions[j] as Position;
  if (j - i === 2) {
    const position = positions[i + 1] as Position;
    return { node: i + 1, angle: edgeAngle(viewerAt(position), position, a, b) };
  }
  if (scratch.length < j) scratch = new Float64Array(Math.max(j, 2 * scratch.length));
  const bounds = scratch;
  // The angle of a position is not more than its bound. The position with the largest bound gets the first best angle,
  // so the bounds of the other positions skip most of them.
  let top = i + 1;
  let topBound = -1;
  for (let k = i + 1; k < j; k += 1) {
    const bound = Math.max(Number.MIN_VALUE, angleBoundToEdge(viewerAt(positions[k] as Position), a, b));
    bounds[k] = bound;
    if (bound > topBound) {
      top = k;
      topBound = bound;
    }
  }
  const first = positions[top] as Position;
  let node = top;
  let best = edgeAngle(viewerAt(first), first, a, b);
  for (let k = i + 1; k < j; k += 1) {
    const bound = bounds[k] as number;
    // A position wins with an angle more than the best, or with the same angle before the node.
    if (k === top || bound < best || (bound === best && k > node)) continue;
    const position = positions[k] as Position;
    const angle = edgeAngle(viewerAt(position), position, a, b);
    if (angle > best || (angle === best && k < node)) {
      node = k;
      best = angle;
    }
  }
  return { node, angle: best };
}

/** This function makes an arc with no tree. A simplification makes the nodes that it reads. */
function arcOf(positions: readonly Position[]): Arc {
  const count = positions.length;
  return {
    positions,
    angles: new Float64Array(count),
    left: new Int32Array(count).fill(-1),
    right: new Int32Array(count).fill(-1),
    starts: new Int32Array(count),
    ends: new Int32Array(count),
    root: UNMADE,
  };
}

/** This function splits the span from `i` to `j` of an arc. It gives the new node, or -1 for a span with no inner position. */
function split(arc: Arc, i: number, j: number): number {
  if (j - i < 2) return -1;
  const { node, angle } = farthest(arc.positions, i, j);
  arc.angles[node] = angle;
  arc.starts[node] = i;
  arc.ends[node] = j;
  arc.left[node] = UNMADE;
  arc.right[node] = UNMADE;
  return node;
}

/** This function gives the node that splits the full arc, or -1. */
function rootOf(arc: Arc): number {
  if (arc.root === UNMADE) arc.root = split(arc, 0, arc.positions.length - 1);
  return arc.root;
}

/** This function gives the left child of a node, or -1. A position that is not a node has no children. */
function leftOf(arc: Arc, node: number): number {
  let child = arc.left[node] as number;
  if (child === UNMADE) {
    child = split(arc, arc.starts[node] as number, node);
    arc.left[node] = child;
  }
  return child;
}

/** This function gives the right child of a node, or -1. A position that is not a node has no children. */
function rightOf(arc: Arc, node: number): number {
  let child = arc.right[node] as number;
  if (child === UNMADE) {
    child = split(arc, node, arc.ends[node] as number);
    arc.right[node] = child;
  }
  return child;
}

/** This function makes the topology of valid regions: the shared arcs and the rings of each region. */
/**
 * This function gives the topology of the regions. Each position for which `fixed` gives `true` is a junction, so the
 * simplification keeps it.
 */
function topologyOf(regions: readonly Region[], fixed?: (position: Position) => boolean): Topology {
  const opened = regions.map((region) => polygonsOf(region).map((rings) => rings.map(openRing)));
  // Each different position gets an id. Most positions have a longitude of their own, so the map by longitude finds
  // them with no key. The map by key holds the other positions. A map finds 0 for -0, as `===` does.
  const byLon = new Map<number, number>();
  const byKey = new Map<string, number>();
  const lats: number[] = [];
  const fixedIds: number[] = [];
  const idOf = (position: Position): number => {
    const first = byLon.get(position[0]);
    if (first === undefined) {
      byLon.set(position[0], lats.length);
      if (fixed?.(position) === true) fixedIds.push(lats.length);
      lats.push(position[1]);
      return lats.length - 1;
    }
    if (lats[first] === position[1]) return first;
    const key = keyOf(position);
    let id = byKey.get(key);
    if (id === undefined) {
      id = lats.length;
      byKey.set(key, id);
      if (fixed?.(position) === true) fixedIds.push(id);
      lats.push(position[1]);
    }
    return id;
  };
  const keyed = new Map<readonly Position[], Int32Array>();
  for (const ring of opened.flat(2)) {
    const ringIds = new Int32Array(ring.length);
    for (let index = 0; index < ring.length; index += 1) ringIds[index] = idOf(ring[index] as Position);
    if (hasThreeDifferent(ringIds)) keyed.set(ring, ringIds);
  }
  const junctions = findJunctions([...keyed.values()], lats.length);
  for (const id of fixedIds) junctions[id] = 1;
  const arcs: Arc[] = [];
  // The ids of each arc, and the arcs by the id of their first position. Two arcs are the same when their ids are equal.
  const arcIds: Int32Array[] = [];
  const found = new Map<number, number[]>();
  const refOf = (ring: readonly Position[], ringIds: Int32Array, order: readonly number[]): ArcRef => {
    const count = order.length;
    // The direction of the arc whose keys come first, one key at a time. This is also the order of the joined keys,
    // because a space comes before each character of a key. Equal ids have equal keys.
    let canonical = true;
    for (let s = 0, e = count - 1; s < e; s += 1, e -= 1) {
      const start = order[s] as number;
      const end = order[e] as number;
      if (ringIds[start] !== ringIds[end]) {
        canonical = keyOf(ring[start] as Position) < keyOf(ring[end] as Position);
        break;
      }
    }
    const sequenceIds = new Int32Array(count);
    for (let step = 0; step < count; step += 1) {
      sequenceIds[step] = ringIds[order[canonical ? step : count - 1 - step] as number] as number;
    }
    const firstId = sequenceIds[0] as number;
    const candidates = found.get(firstId);
    let index = candidates?.find((candidate) => sameIds(arcIds[candidate] as Int32Array, sequenceIds));
    if (index === undefined) {
      index = arcs.length;
      const sequence = canonical ? order : [...order].reverse();
      arcs.push(arcOf(sequence.map((k) => ring[k] as Position)));
      arcIds.push(sequenceIds);
      if (candidates === undefined) found.set(firstId, [index]);
      else candidates.push(index);
    }
    return canonical ? index : ~index;
  };
  const topologyRegions = regions.map((region, regionIndex): TopologyRegion => ({
    type: region.type,
    polygons: polygonsOf(region).map((rings, polygonIndex) =>
      rings.map((ring, ringIndex): TopologyRing => {
        const open = opened[regionIndex]?.[polygonIndex]?.[ringIndex] as Position[];
        const ringIds = keyed.get(open);
        if (ringIds === undefined) return { fixed: ring };
        const refs = cutRing(open, ringIds, junctions).map((order) => refOf(open, ringIds, order));
        return { arcs: refs, first: open[0] as Position };
      }),
    ),
  }));
  return { arcs, regions: topologyRegions };
}

/** This function gives `true` when two lists of ids are equal. */
function sameIds(a: Int32Array, b: Int32Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
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
  const root = rootOf(arc);
  let current = keeps(root) ? root : -1;
  while (current >= 0 || stack.length > 0) {
    while (current >= 0) {
      stack.push(current);
      const next = leftOf(arc, current);
      current = keeps(next) ? next : -1;
    }
    const node = stack.pop() as number;
    kept.push(node);
    const next = rightOf(arc, node);
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
  for (const node of [rightOf(arc, i), leftOf(arc, j), rootOf(arc)]) if (node > i && node < j) return node;
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
  const start = positions.findIndex((position) => samePosition(position, ring.first));
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
 * This function simplifies valid regions with the rules of `simplifyRegions`, and it keeps each position for which
 * `fixed` gives `true`. It does not examine the regions.
 *
 * @internal
 */
export function simplifyKeeping(
  regions: readonly Region[],
  toleranceKm: number,
  radiusKm: number,
  fixed: (position: Position) => boolean,
): Region[] {
  return simplifyTopology(topologyOf(regions, fixed), toleranceKm, radiusKm);
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
