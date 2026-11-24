/**
 * This module gives the steps of a route on a road graph, for a route on paper. A step is a leg on one road with the
 * turn at its start, or the arrival.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import type { Feature, FeatureCollection } from "./geojson.ts";
import { normalizeLon, type Position } from "./point.ts";
import { defaultTags, routeEdges, type RoadEdge, type RoadGraph } from "./roads.ts";
import { initialBearing } from "./sphere.ts";

/**
 * The turn at the start of a step.
 *
 * - `depart`: the first leg of the route.
 * - `straight`, `slight-left`, `left`, `sharp-left`, `slight-right`, `right`, `sharp-right` and `u-turn`: the turn
 *   from the leg before, from `TURN_DEGREES`.
 * - `arrive`: the last step of the route. It has 0 metres.
 */
export type RouteTurn =
  | "depart"
  | "straight"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "u-turn"
  | "arrive";

/**
 * The limits of the turns in degrees, for the absolute value of the change of bearing.
 *
 * - `straight`: a change less than this limit is `straight`.
 * - `slight`: a change less than this limit is `slight-left` or `slight-right`.
 * - `turn`: a change less than this limit is `left` or `right`.
 * - `sharp`: a change less than this limit is `sharp-left` or `sharp-right`. A larger change is `u-turn`.
 */
export interface TurnDegrees {
  readonly straight: number;
  readonly slight: number;
  readonly turn: number;
  readonly sharp: number;
}

/**
 * The limits of the turns of `routeSteps` in degrees: straight below 20, slight below 60 and normal below 120. A sharp
 * turn is below 170, and a U-turn is from 170.
 */
export const TURN_DEGREES: TurnDegrees = Object.freeze({ straight: 20, slight: 60, turn: 120, sharp: 170 });

/**
 * A step of a route: a leg on one road, or the arrival.
 *
 * `startIndex` and `endIndex` are indices into the edge list of the route, not into `graph.edges`. The two limits are
 * in the leg.
 */
export interface RouteStep {
  /** The turn at the start of the step. */
  readonly turn: RouteTurn;
  /**
   * The change of the bearing at the start of the step, in degrees from -180 to less than 180. A negative value is a turn
   * to the left. It is 0 for `depart`, for `arrive` and for a leg with no direction.
   */
  readonly bearingChange: number;
  /** The name of the road. An empty name is an unnamed road. */
  readonly name: string;
  /** The value of the tag `ref` of the first edge of the leg, when it has one. */
  readonly ref?: string;
  /** The sum of the `meters` of the edges of the leg. It is 0 for `arrive`. */
  readonly meters: number;
  /** The index of the first edge of the leg in the edge list. For `arrive`, it is the index of the last edge. */
  readonly startIndex: number;
  /** The index of the last edge of the leg in the edge list. For `arrive`, it is the index of the last edge. */
  readonly endIndex: number;
}

/** The options of `routeSteps`. */
export interface RouteStepsOptions {
  /**
   * The features that made the graph, as the input of `roadGraph`. The field `feature` of each edge is an index into
   * this list. With no features, each road has an empty name.
   */
  readonly features?: readonly Feature[] | FeatureCollection;
  /** This function gives the tags of a feature. The default is the default of `roadGraph`. */
  readonly tags?: (feature: Feature) => Readonly<Record<string, unknown>> | null | undefined;
  /**
   * This function gives the name of the road of a feature. The default is the tag `name`, then the tag `ref`, then an
   * empty name.
   */
  readonly nameOf?: (feature: Feature, index: number) => string;
  /**
   * A leg shorter than this length joins the legs on its two sides when those two legs have the same name. The default
   * is 0, so no leg joins.
   */
  readonly minLegMeters?: number;
}

/** The name and the ref of the road of one feature. */
interface RoadName {
  readonly name: string;
  readonly ref?: string;
}

/** A leg while the function makes it. */
interface Leg {
  readonly name: string;
  readonly ref?: string;
  meters: number;
  readonly start: number;
  end: number;
}

function tagText(tags: unknown, tag: string): string | undefined {
  if (typeof tags !== "object" || tags === null) return undefined;
  const value = (tags as Readonly<Record<string, unknown>>)[tag];
  const text = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  return text === "" ? undefined : text;
}

function nameReader(options: RouteStepsOptions): (feature: number) => RoadName {
  const features = options.features;
  const list = features === undefined ? [] : Array.isArray(features) ? features : (features as FeatureCollection | null)?.features;
  if (!Array.isArray(list)) throw new GeoError("geojson-member", "The features must be an array or a feature collection");
  const readTags = options.tags ?? defaultTags;
  const names = new Map<number, RoadName>();
  return (index) => {
    const known = names.get(index);
    if (known !== undefined) return known;
    const feature = list[index] as Feature | undefined;
    let road: RoadName = { name: "" };
    if (feature !== undefined) {
      const tags = readTags(feature);
      const ref = tagText(tags, "ref");
      const given = options.nameOf?.(feature, index);
      const name = options.nameOf === undefined ? (tagText(tags, "name") ?? ref ?? "") : typeof given === "string" ? given : "";
      road = ref === undefined ? { name } : { name, ref };
    }
    names.set(index, road);
    return road;
  };
}

function samePosition(a: Position, b: Position): boolean {
  return a[1] === b[1] && (Math.abs(a[1]) === 90 || normalizeLon(a[0]) === normalizeLon(b[0]));
}

/** This function gives the bearing at the end of the last segment with a length of the edges `first` to `last`. */
function endBearing(route: readonly RoadEdge[], first: number, last: number): number | undefined {
  for (let e = last; e >= first; e -= 1) {
    const line = route[e]!.line;
    for (let k = line.length - 1; k >= 1; k -= 1) {
      const a = line[k - 1]!;
      const b = line[k]!;
      // The final bearing from a to b is the reverse of the initial bearing from b to a.
      if (!samePosition(a, b)) return (initialBearing({ lat: b[1], lon: b[0] }, { lat: a[1], lon: a[0] }) + 180) % 360;
    }
  }
  return undefined;
}

/** This function gives the bearing at the start of the first segment with a length of the edges `first` to `last`. */
function startBearing(route: readonly RoadEdge[], first: number, last: number): number | undefined {
  for (let e = first; e <= last; e += 1) {
    const line = route[e]!.line;
    for (let k = 1; k < line.length; k += 1) {
      const a = line[k - 1]!;
      const b = line[k]!;
      if (!samePosition(a, b)) return initialBearing({ lat: a[1], lon: a[0] }, { lat: b[1], lon: b[0] });
    }
  }
  return undefined;
}

function turnOf(change: number): RouteTurn {
  const size = Math.abs(change);
  const left = change < 0;
  if (size < TURN_DEGREES.straight) return "straight";
  if (size < TURN_DEGREES.slight) return left ? "slight-left" : "slight-right";
  if (size < TURN_DEGREES.turn) return left ? "left" : "right";
  if (size < TURN_DEGREES.sharp) return left ? "sharp-left" : "sharp-right";
  return "u-turn";
}

/**
 * This function gives the steps of a route for a route on paper: a leg for each road, with its turn, and the arrival.
 *
 * - `edges` are indices of `graph.edges`, in the order of the route, as for `routeLine`.
 * - Consecutive edges with the same road name make one leg. A change of name makes a new leg, also with no real turn.
 *   Then the turn is `straight`. A turn on a road with one name makes no new leg.
 * - The turn of a leg comes from the change of the bearing at its start. The two bearings are on the last segment of
 *   the leg before and on the first segment of the leg. `initialBearing` gives them. `TURN_DEGREES` gives the limits of the turns.
 * - A segment of length 0 has no direction, so the function skips it. A leg with no direction gives a change of 0.
 * - The first leg has the turn `depart`. The last step has the turn `arrive` and 0 metres.
 * - With `minLegMeters`, a leg shorter than that length joins its two neighbors when they have the same name. The
 *   function examines the legs from the start, one time. The first and the last legs do not join.
 *
 * @param graph - The road graph of the route.
 * @param edges - The indices of the edges of the route in `graph.edges`.
 * @param options - The features of the graph, the tag reader, the name of a road and the shortest leg.
 * @returns The legs in the order of the route, and then the arrival.
 * @throws GeoError - The code is `route` for no edges, an index that is not an edge, or two edges that do not join.
 *   The code is `tolerance` for a `minLegMeters` that is not a finite number from 0. The code is `geojson-member`
 *   for features that are not an array or a feature collection.
 */
export function routeSteps(graph: RoadGraph, edges: readonly number[], options: RouteStepsOptions = {}): RouteStep[] {
  const route = routeEdges(graph, edges);
  const minLegMeters = options.minLegMeters ?? 0;
  if (typeof minLegMeters !== "number" || !Number.isFinite(minLegMeters) || minLegMeters < 0) {
    throw new GeoError("tolerance", `The shortest leg ${String(minLegMeters)} is not a finite number from 0`);
  }
  const roadOf = nameReader(options);

  const legs: Leg[] = [];
  route.forEach((edge, k) => {
    const road = roadOf(edge.feature);
    const last = legs.at(-1);
    if (last !== undefined && last.name === road.name) {
      last.meters += edge.meters;
      last.end = k;
    } else {
      legs.push({ ...road, meters: edge.meters, start: k, end: k });
    }
  });

  if (minLegMeters > 0) {
    let i = 1;
    while (i + 1 < legs.length) {
      const before = legs[i - 1]!;
      const leg = legs[i]!;
      const after = legs[i + 1]!;
      if (leg.meters < minLegMeters && before.name === after.name) {
        before.meters += leg.meters + after.meters;
        before.end = after.end;
        legs.splice(i, 2);
      } else {
        i += 1;
      }
    }
  }

  const steps: RouteStep[] = legs.map((leg, i) => {
    let turn: RouteTurn = "depart";
    let change = 0;
    if (i > 0) {
      const before = legs[i - 1]!;
      const from = endBearing(route, before.start, before.end);
      const to = startBearing(route, leg.start, leg.end);
      if (from !== undefined && to !== undefined) change = ((((to - from) % 360) + 540) % 360) - 180;
      turn = turnOf(change);
    }
    return step(turn, change, leg, leg.meters, leg.start);
  });
  const last = legs.at(-1)!;
  steps.push(step("arrive", 0, last, 0, last.end));
  return steps;
}

function step(turn: RouteTurn, bearingChange: number, leg: Leg, meters: number, startIndex: number): RouteStep {
  return Object.freeze({
    turn,
    bearingChange,
    name: leg.name,
    ...(leg.ref === undefined ? {} : { ref: leg.ref }),
    meters,
    startIndex,
    endIndex: leg.end,
  });
}
