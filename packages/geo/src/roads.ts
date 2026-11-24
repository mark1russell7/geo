/**
 * This module makes a road graph from GeoJSON lines, for example the ways of OpenStreetMap. A route search on the
 * graph needs no network.
 *
 * - `roadGraph` gives the nodes and the directed edges of a travel mode. Each edge has its length in metres and its line.
 * - `wayAccess` gives the directions of one way for a travel mode, from the tags and the table of the mode.
 * - `nearestNode` and `snapToRoad` connect a point to the graph.
 * - `routeLine` gives the GeoJSON line of a route and its length.
 *
 * The edges have the fields `from`, `to` and `weight`, so a shortest-path search on a list of directed edges accepts
 * them with no change.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import { checkPosition, type Feature, type FeatureCollection, type LineString } from "./geojson.ts";
import { checkPoint, normalizeLon, type LatLon, type Position } from "./point.ts";
import { azimuthalEquidistant, type PlanePoint } from "./projection.ts";
import { distanceMeters } from "./sphere.ts";

/** A rule that makes a way one-way when the way has no oneway tag: the tag and its values. */
export interface ImpliedOneway {
  readonly tag: string;
  readonly values: readonly string[];
}

/**
 * The rules of a travel mode, as a table. A caller can give its own table.
 *
 * - `highways`: the values of the tag `highway` that the mode can use.
 * - `access`: the access tags, the most specific first. The first tag that a way has decides.
 * - `denied`: the access values that close a way.
 * - `oneway`: the oneway tags, the most specific first. The first tag that a way has decides. An empty list ignores each oneway tag.
 * - `impliedOneway`: the rules that make a way one-way when it has none of the tags of `oneway`.
 */
export interface TravelMode {
  readonly name: string;
  readonly highways: readonly string[];
  readonly access: readonly string[];
  readonly denied: readonly string[];
  readonly oneway: readonly string[];
  readonly impliedOneway: readonly ImpliedOneway[];
}

/** The values of a oneway tag for the direction of the line. */
export const ONEWAY_FORWARD: readonly string[] = Object.freeze(["yes", "true", "1"]);

/** The values of a oneway tag for the direction against the line. */
export const ONEWAY_BACKWARD: readonly string[] = Object.freeze(["-1", "reverse"]);

/**
 * The travel mode on foot. Only the tag `oneway:foot` makes a way one-way. A motorway and a trunk road are not in
 * the table.
 */
export const WALK: TravelMode = Object.freeze({
  name: "walk",
  highways: Object.freeze([
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "road",
    "pedestrian",
    "footway",
    "path",
    "steps",
    "track",
  ]),
  access: Object.freeze(["foot", "access"]),
  denied: Object.freeze(["no", "private"]),
  oneway: Object.freeze(["oneway:foot"]),
  impliedOneway: Object.freeze([]),
});

/**
 * The travel mode by car. The tag `oneway` applies. A roundabout and a motorway are one-way when they have no
 * oneway tag.
 */
export const DRIVE: TravelMode = Object.freeze({
  name: "drive",
  highways: Object.freeze([
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
    "road",
  ]),
  access: Object.freeze(["motor_vehicle", "vehicle", "access"]),
  denied: Object.freeze(["no", "private"]),
  oneway: Object.freeze(["oneway"]),
  impliedOneway: Object.freeze([
    Object.freeze({ tag: "junction", values: Object.freeze(["roundabout", "circular"]) }),
    Object.freeze({ tag: "highway", values: Object.freeze(["motorway"]) }),
  ]),
});

/** The travel modes of this package, by name. */
export const TRAVEL_MODES: Readonly<Record<"walk" | "drive", TravelMode>> = Object.freeze({ walk: WALK, drive: DRIVE });

/**
 * The directions of a way for a travel mode.
 *
 * - `closed`: the mode cannot use the way.
 * - `both`: the mode can go in the two directions.
 * - `forward`: the mode can go only in the direction of the line.
 * - `backward`: the mode can go only against the direction of the line.
 */
export type WayAccess = "closed" | "both" | "forward" | "backward";

/** A node of a road graph: a position that two or more ways share, or an end of a way. */
export interface RoadNode {
  readonly id: string;
  readonly point: LatLon;
}

/**
 * A directed edge of a road graph: the part of one way between two nodes, in one direction.
 *
 * `weight` is `meters` when `roadGraph` makes the edge. A caller can make a copy with a different weight, for example a time.
 */
export interface RoadEdge {
  readonly from: string;
  readonly to: string;
  readonly weight: number;
  /** The length of `line` on the sphere, from `distanceMeters`. */
  readonly meters: number;
  /** The positions from the node `from` to the node `to`. */
  readonly line: readonly Position[];
  /** The index of the feature of the way in the input. */
  readonly feature: number;
  /** The number of the part of the way. The two directions of one part have the same number. */
  readonly segment: number;
}

/** A road graph of one travel mode. Each node in `nodes` is an end of one edge or more. */
export interface RoadGraph {
  readonly mode: string;
  readonly nodes: ReadonlyMap<string, RoadNode>;
  readonly edges: readonly RoadEdge[];
}

/** The options of `roadGraph`. */
export interface RoadGraphOptions {
  /** The travel mode: a name of `TRAVEL_MODES`, or a table. */
  readonly mode: TravelMode | "walk" | "drive";
  /**
   * This function gives the tags of a feature. The default is the object `properties.tags` when the feature has it,
   * else `properties`.
   */
  readonly tags?: (feature: Feature) => Readonly<Record<string, unknown>> | null | undefined;
  /**
   * This function gives the key of a position. Two positions with the same key are one node. The default key is the
   * latitude and the normalized longitude, with no rounding. Give the identifier of the OpenStreetMap node when the
   * input has it.
   */
  readonly vertexKey?: (position: Position, feature: Feature, index: number, part: number) => string;
}

/** The result of `nearestNode`. */
export interface NearestNode {
  readonly node: RoadNode;
  /** The distance from the point to the node, from `distanceMeters`. */
  readonly meters: number;
}

/** The options of `snapToRoad`. */
export interface SnapOptions {
  /**
   * The distance from an end of an edge in metres, within which the point goes to that end and not to a new node. The
   * default is 0.5.
   */
  readonly toleranceMeters?: number;
  /** The identifier of a new node. The default is the key of its position, as the default key of `roadGraph`. */
  readonly id?: string;
}

/** The result of `snapToRoad`. */
export interface RoadSnap {
  /** The graph with the new node and its edges. It is the input graph when the point goes to a node. */
  readonly graph: RoadGraph;
  /** The node of the point: a node of the input graph, or a new node on an edge. */
  readonly node: RoadNode;
  /** The distance from the point to the node in metres. */
  readonly meters: number;
  /** True when the function cut an edge to add the node. */
  readonly split: boolean;
}

/** The result of `routeLine`. */
export interface RouteLine {
  readonly line: LineString;
  /** The sum of the `meters` of the edges. */
  readonly meters: number;
}

/** This function gives the default key of a position: the latitude and the normalized longitude, with no rounding. */
function positionKey(position: Position): string {
  const lat = position[1];
  // Each longitude at a pole is the same point.
  if (lat === 90 || lat === -90) return `${lat}`;
  return `${lat + 0},${normalizeLon(position[0])}`;
}

function toLatLon(position: Position): LatLon {
  return { lat: position[1], lon: position[0] };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * This function gives the default tags of a feature: the object `properties.tags` when the feature has it, else
 * `properties`. `roadGraph` and `routeSteps` use it.
 *
 * @internal
 */
export function defaultTags(feature: Feature): Readonly<Record<string, unknown>> | null {
  const properties = feature.properties;
  if (!isRecord(properties)) return null;
  return isRecord(properties["tags"]) ? properties["tags"] : properties;
}

function tagValue(tags: Readonly<Record<string, unknown>>, tag: string): string | undefined {
  const value = tags[tag];
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function checkMode(mode: TravelMode | string): TravelMode {
  if (typeof mode === "string") {
    const found = (TRAVEL_MODES as Readonly<Record<string, TravelMode>>)[mode];
    if (found === undefined || !Object.hasOwn(TRAVEL_MODES, mode)) {
      throw new GeoError("travel-mode", `The travel mode "${mode}" is not walk or drive`);
    }
    return found;
  }
  const lists = isRecord(mode) ? [mode.highways, mode.access, mode.denied, mode.oneway] : [];
  const valid =
    lists.length === 4 &&
    lists.every((list) => Array.isArray(list) && list.every((item) => typeof item === "string")) &&
    Array.isArray(mode.impliedOneway) &&
    mode.impliedOneway.every((rule) => isRecord(rule) && typeof rule["tag"] === "string" && Array.isArray(rule["values"]));
  if (!valid) throw new GeoError("travel-mode", "A travel mode has the string lists highways, access, denied and oneway, and impliedOneway");
  return mode;
}

/**
 * This function gives the directions of a way for a travel mode, from the tags of the way.
 *
 * - A way with a `highway` value that is not in `mode.highways` is `closed`.
 * - The first tag of `mode.access` that the way has decides the access. A value of `mode.denied` closes the way.
 * - The first tag of `mode.oneway` that the way has decides the direction. The values of `ONEWAY_FORWARD` give
 *   `forward`, and the values of `ONEWAY_BACKWARD` (`-1` and `reverse`) give `backward`. Each other value gives `both`.
 * - With none of these tags, a rule of `mode.impliedOneway` gives `forward`.
 * - The function compares the values in lower case, with no spaces at the ends.
 *
 * @throws GeoError - The code is `travel-mode` for a name that is not in `TRAVEL_MODES`, or for an incorrect table.
 */
export function wayAccess(tags: Readonly<Record<string, unknown>> | null | undefined, mode: TravelMode | "walk" | "drive"): WayAccess {
  const table = checkMode(mode);
  if (!isRecord(tags)) return "closed";
  const highway = tagValue(tags, "highway");
  if (highway === undefined || !table.highways.includes(highway)) return "closed";
  for (const tag of table.access) {
    const value = tagValue(tags, tag);
    if (value === undefined) continue;
    if (table.denied.includes(value)) return "closed";
    break;
  }
  for (const tag of table.oneway) {
    const value = tagValue(tags, tag);
    if (value === undefined) continue;
    if (ONEWAY_FORWARD.includes(value)) return "forward";
    if (ONEWAY_BACKWARD.includes(value)) return "backward";
    return "both";
  }
  for (const rule of table.impliedOneway) {
    const value = tagValue(tags, rule.tag);
    if (value !== undefined && rule.values.includes(value)) return "forward";
  }
  return "both";
}

/** A part of a way that the mode can use: its positions and their keys, with no two equal keys next to each other. */
interface WayPart {
  readonly feature: number;
  readonly access: Exclude<WayAccess, "closed">;
  readonly positions: readonly Position[];
  readonly keys: readonly string[];
}

/** This function gives the length of a line on the sphere, from `distanceMeters`. */
function lengthOf(line: readonly Position[]): number {
  let meters = 0;
  for (let index = 1; index < line.length; index += 1) meters += distanceMeters(toLatLon(line[index - 1]!), toLatLon(line[index]!));
  return meters;
}

/**
 * This function makes the road graph of a travel mode from GeoJSON lines, for example the ways of OpenStreetMap.
 *
 * - The function reads each feature with a `LineString` or a `MultiLineString`. It skips each other feature.
 *   `wayAccess` decides if the mode can use a way, and in which directions.
 * - A node is a position that two or more ways share, a position that one way has two times, or an end of a way.
 *   Two lines that cross with no shared position, for example at a bridge, have no junction.
 * - An edge is the part of a way between two nodes, with its length in metres and its line. A way in the two
 *   directions gives two edges, the edge in the direction of the line first.
 * - Two equal positions next to each other count one time. A part of a way from a node back to the same node, with no
 *   other node, gives no edge.
 * - The order of the edges and of the nodes is the order of the input, so the same input gives the same graph.
 *
 * @param features - The features, or a feature collection.
 * @param options - The travel mode, and the functions that read the tags and the keys.
 * @returns The graph. Its edges have `from`, `to` and `weight`, the shape of a shortest-path search on directed edges.
 * @throws GeoError - The code is `travel-mode`, `geojson-member`, `position`, `not-finite`, `latitude-range` or `too-few-positions`.
 */
export function roadGraph(features: readonly Feature[] | FeatureCollection, options: RoadGraphOptions): RoadGraph {
  const mode = checkMode(options.mode);
  const list = Array.isArray(features) ? features : (features as FeatureCollection | null)?.features;
  if (!Array.isArray(list)) throw new GeoError("geojson-member", "The features must be an array or a feature collection");
  const readTags = options.tags ?? defaultTags;
  const keyOf = options.vertexKey ?? ((position: Position) => positionKey(position));

  const parts: WayPart[] = [];
  list.forEach((feature: Feature, index: number) => {
    const geometry: unknown = isRecord(feature) ? feature.geometry : null;
    if (!isRecord(geometry) || (geometry["type"] !== "LineString" && geometry["type"] !== "MultiLineString")) return;
    const access = wayAccess(readTags(feature), mode);
    if (access === "closed") return;
    const single = geometry["type"] === "LineString";
    const lines: unknown = single ? [geometry["coordinates"]] : geometry["coordinates"];
    const path = `[${index}].geometry.coordinates`;
    if (!Array.isArray(lines)) throw new GeoError("geojson-member", "The coordinates must be an array", path);
    (lines as readonly unknown[]).forEach((value, part) => {
      const at = single ? path : `${path}[${part}]`;
      if (!Array.isArray(value)) throw new GeoError("geojson-member", "A line must be an array of positions", at);
      value.forEach((position, k) => checkPosition(position, `${at}[${k}]`));
      const line = value as readonly Position[];
      if (line.length < 2) throw new GeoError("too-few-positions", "A line has two or more positions", at);
      const positions: Position[] = [];
      const keys: string[] = [];
      line.forEach((position, k) => {
        const key = keyOf(position, feature, k, part);
        if (keys.at(-1) === key) return;
        positions.push(position);
        keys.push(key);
      });
      if (positions.length >= 2) parts.push({ feature: index, access, positions, keys });
    });
  });

  const uses = new Map<string, number>();
  for (const part of parts) for (const key of part.keys) uses.set(key, (uses.get(key) ?? 0) + 1);

  const nodes = new Map<string, RoadNode>();
  const addNode = (key: string, position: Position): void => {
    if (!nodes.has(key)) nodes.set(key, Object.freeze({ id: key, point: toLatLon(position) }));
  };
  const edges: RoadEdge[] = [];
  let segment = 0;
  for (const part of parts) {
    let start = 0;
    for (let k = 1; k < part.positions.length; k += 1) {
      const last = k === part.positions.length - 1;
      if (!last && (uses.get(part.keys[k]!) ?? 0) < 2) continue;
      const from = part.keys[start]!;
      const to = part.keys[k]!;
      const line = part.positions.slice(start, k + 1);
      start = k;
      if (from === to) continue;
      addNode(from, line[0]!);
      addNode(to, line.at(-1)!);
      const meters = lengthOf(line);
      const base = { weight: meters, meters, feature: part.feature, segment };
      if (part.access !== "backward") edges.push(Object.freeze({ from, to, ...base, line }));
      if (part.access !== "forward") edges.push(Object.freeze({ from: to, to: from, ...base, line: line.toReversed() }));
      segment += 1;
    }
  }
  return Object.freeze({ mode: mode.name, nodes, edges: Object.freeze(edges) });
}

/**
 * This function gives the node of a road graph that is nearest to a point, with the distance from `distanceMeters`.
 * Two nodes at the same distance give the first in the order of `graph.nodes`.
 *
 * @returns The nearest node, or `undefined` for a graph with no nodes.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `not-a-point`.
 */
export function nearestNode(graph: RoadGraph, point: LatLon): NearestNode | undefined {
  checkPointValue(point);
  let best: NearestNode | undefined;
  for (const node of graph.nodes.values()) {
    const meters = distanceMeters(point, node.point);
    if (best === undefined || meters < best.meters) best = { node, meters };
  }
  return best;
}

function checkPointValue(point: LatLon): void {
  if (!isRecord(point) || typeof point.lat !== "number" || typeof point.lon !== "number") {
    throw new GeoError("not-a-point", "A point is an object with the numbers lat and lon");
  }
  checkPoint(point);
}

/** The nearest point of an edge: the edge, the segment of its line, the fraction along that segment and the plane point. */
interface EdgeHit {
  readonly edge: number;
  readonly index: number;
  readonly t: number;
  readonly meters: number;
  readonly at: PlanePoint;
}

/**
 * This function connects a point to a road graph. It gives the nearest node, or a new node at the nearest point of an
 * edge.
 *
 * - Each distance to a node or an edge is on the plane of `azimuthalEquidistant` at the point. Each distance from its
 *   center is exact on the ellipsoid. `nearestNode` gives the first candidate.
 * - When the nearest point of an edge is nearer than each node, the function cuts the edge there. It cuts the edge in
 *   the other direction of the same part too. Each new edge keeps the weight of its share of the length.
 * - A nearest point within `toleranceMeters` of an end of its edge goes to that end, with no cut.
 * - The function does not change its arguments. With a cut, the result has a new graph.
 *
 * @returns The node of the point, and the graph with that node. The result is `undefined` for a graph with no nodes.
 * @throws GeoError - The code is `not-finite`, `latitude-range`, `not-a-point` or `tolerance`.
 */
export function snapToRoad(graph: RoadGraph, point: LatLon, options: SnapOptions = {}): RoadSnap | undefined {
  const tolerance = options.toleranceMeters ?? 0.5;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new GeoError("tolerance", `The tolerance ${tolerance} is not a finite number from 0`);
  const near = nearestNode(graph, point);
  if (near === undefined) return undefined;
  const plane = azimuthalEquidistant(point);
  const planeMeters = (node: RoadNode): number => {
    const at = plane.toPlane(node.point);
    return Math.hypot(at.x, at.y);
  };
  let hit: EdgeHit | undefined;
  let best = planeMeters(near.node);
  graph.edges.forEach((edge, e) => {
    for (let k = 1; k < edge.line.length; k += 1) {
      const a = toLatLon(edge.line[k - 1]!);
      const b = toLatLon(edge.line[k]!);
      // Each point of a segment is within half its length of an end. With a margin for the sphere, this skips far segments.
      const reach = Math.min(distanceMeters(point, a), distanceMeters(point, b)) - distanceMeters(a, b) / 2;
      if (reach * 0.99 > best) continue;
      const pa = plane.toPlane(a);
      const pb = plane.toPlane(b);
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const squared = dx * dx + dy * dy;
      const t = squared === 0 ? 0 : Math.max(0, Math.min(1, -(pa.x * dx + pa.y * dy) / squared));
      const at = t === 1 ? pb : { x: pa.x + t * dx, y: pa.y + t * dy };
      const meters = Math.hypot(at.x, at.y);
      if (meters < best) {
        best = meters;
        hit = { edge: e, index: k - 1, t, meters, at };
      }
    }
  });
  if (hit === undefined) return { graph, node: near.node, meters: best, split: false };

  const edge = graph.edges[hit.edge]!;
  const position: Position =
    hit.t === 0 ? edge.line[hit.index]! : hit.t === 1 ? edge.line[hit.index + 1]! : toPosition(plane.fromPlane(hit.at));
  const head = [...edge.line.slice(0, hit.index + 1), position];
  const tail = [position, ...edge.line.slice(hit.index + 1)];
  if (hit.t === 0) head.pop();
  if (hit.t === 1) tail.shift();
  const headMeters = lengthOf(head);
  const tailMeters = lengthOf(tail);
  const toNode = (node: RoadNode): RoadSnap => ({ graph, node, meters: planeMeters(node), split: false });
  if (head.length < 2 || headMeters <= tolerance) return toNode(graph.nodes.get(edge.from)!);
  if (tail.length < 2 || tailMeters <= tolerance) return toNode(graph.nodes.get(edge.to)!);

  const id = options.id ?? positionKey(position);
  const existing = graph.nodes.get(id);
  if (existing !== undefined) return toNode(existing);
  const node: RoadNode = Object.freeze({ id, point: toLatLon(position) });
  const share = (whole: RoadEdge, meters: number): number => (whole.meters > 0 ? (whole.weight * meters) / whole.meters : 0);
  const edges: RoadEdge[] = [];
  for (const other of graph.edges) {
    const same = other.segment === edge.segment;
    if (same && other.from === edge.from && other.to === edge.to) {
      edges.push(
        Object.freeze({ ...other, to: id, line: head, meters: headMeters, weight: share(other, headMeters) }),
        Object.freeze({ ...other, from: id, line: tail, meters: tailMeters, weight: share(other, tailMeters) }),
      );
    } else if (same && other.from === edge.to && other.to === edge.from) {
      edges.push(
        Object.freeze({ ...other, to: id, line: tail.toReversed(), meters: tailMeters, weight: share(other, tailMeters) }),
        Object.freeze({ ...other, from: id, line: head.toReversed(), meters: headMeters, weight: share(other, headMeters) }),
      );
    } else {
      edges.push(other);
    }
  }
  const nodes = new Map(graph.nodes);
  nodes.set(id, node);
  return { graph: Object.freeze({ mode: graph.mode, nodes, edges: Object.freeze(edges) }), node, meters: hit.meters, split: true };
}

function toPosition(point: LatLon): Position {
  return [point.lon, point.lat];
}

/**
 * This function gives the GeoJSON line of a route, from the lines of its edges, and its length.
 *
 * - `edges` are indices of `graph.edges`, in the order of the route, for example the edge path of a shortest-path search.
 * - The common position of two edges is in the line one time.
 *
 * @throws GeoError - The code is `route` for no edges, an index that is not an edge, or two edges that do not join.
 */
export function routeLine(graph: RoadGraph, edges: readonly number[]): RouteLine {
  const coordinates: Position[] = [];
  let meters = 0;
  routeEdges(graph, edges).forEach((edge, k) => {
    coordinates.push(...(k === 0 ? edge.line : edge.line.slice(1)));
    meters += edge.meters;
  });
  return { line: { type: "LineString", coordinates }, meters };
}

/**
 * This function gives the edges of a route, from their indices in `graph.edges`. `routeLine` and `routeSteps` use it.
 *
 * @throws GeoError - The code is `route` for no edges, an index that is not an edge, or two edges that do not join.
 * @internal
 */
export function routeEdges(graph: RoadGraph, edges: readonly number[]): RoadEdge[] {
  if (!Array.isArray(edges) || edges.length === 0) throw new GeoError("route", "A route has one edge or more");
  const list: RoadEdge[] = [];
  edges.forEach((index, k) => {
    const edge = Number.isInteger(index) ? graph.edges[index] : undefined;
    if (edge === undefined) throw new GeoError("route", `The route has the edge ${index}, but the graph has no edge with that index`, `[${k}]`);
    const previous = list.at(-1);
    if (previous !== undefined && previous.to !== edge.from) {
      throw new GeoError("route", `The edge ${index} starts at "${edge.from}", not at the end "${previous.to}" of the edge before it`, `[${k}]`);
    }
    list.push(edge);
  });
  return list;
}
