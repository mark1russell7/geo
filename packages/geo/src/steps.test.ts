import { describe, expect, it } from "vitest";
import { GeoError } from "./errors.ts";
import type { Feature, LineString } from "./geojson.ts";
import type { Position } from "./point.ts";
import { roadGraph, type RoadGraph } from "./roads.ts";
import { routeSteps, TURN_DEGREES, type RouteStep } from "./steps.ts";

// The coordinates and the roads are made up: a small grid in the ocean near the point (0, 0). A step of 0.001 degrees
// is approximately 111 metres.

function way(coordinates: Position[], tags: Record<string, unknown>): Feature<LineString> {
  return { type: "Feature", geometry: { type: "LineString", coordinates }, properties: { highway: "residential", ...tags } };
}

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return error.code;
    throw error;
  }
  return undefined;
}

/** This function gives the edge indices of a route through the node keys, in order. */
function path(graph: RoadGraph, ...keys: string[]): number[] {
  const edges: number[] = [];
  for (let k = 1; k < keys.length; k += 1) {
    const index = graph.edges.findIndex((edge) => edge.from === keys[k - 1] && edge.to === keys[k]);
    if (index < 0) throw new Error(`No edge from ${keys[k - 1]} to ${keys[k]}`);
    edges.push(index);
  }
  return edges;
}

function turns(steps: readonly RouteStep[]): string[] {
  return steps.map((step) => `${step.turn} ${step.name}`);
}

const A = "0,0";
const B = "0,0.001";
const C = "0,0.002";
const N = "0.001,0.001";
const S = "-0.001,0.001";

// Main Street goes from west to east, and Oak Avenue from south to north. They meet at B.
const cross = [
  way(
    [
      [0, 0],
      [0.001, 0],
      [0.002, 0],
    ],
    { name: "Main Street" },
  ),
  way(
    [
      [0.001, -0.001],
      [0.001, 0],
      [0.001, 0.001],
    ],
    { name: "Oak Avenue" },
  ),
];

describe("routeSteps", () => {
  it("makes a new straight leg when a straight road changes its name", () => {
    const features = [
      way(
        [
          [0, 0],
          [0.001, 0],
        ],
        { name: "First Street" },
      ),
      way(
        [
          [0.001, 0],
          [0.002, 0],
        ],
        { name: "Second Street" },
      ),
    ];
    const graph = roadGraph(features, { mode: "walk" });
    const steps = routeSteps(graph, path(graph, A, B, C), { features });
    expect(turns(steps)).toEqual(["depart First Street", "straight Second Street", "arrive Second Street"]);
    expect(steps[0]!.bearingChange).toBe(0);
    expect(Math.abs(steps[1]!.bearingChange)).toBeLessThan(1e-6);
  });

  it("gives a left turn and a right turn at a junction", () => {
    const graph = roadGraph(cross, { mode: "walk" });
    const left = routeSteps(graph, path(graph, A, B, N), { features: cross });
    expect(turns(left)).toEqual(["depart Main Street", "left Oak Avenue", "arrive Oak Avenue"]);
    expect(left[1]!.bearingChange).toBeCloseTo(-90, 3);
    const right = routeSteps(graph, path(graph, A, B, S), { features: cross });
    expect(turns(right)).toEqual(["depart Main Street", "right Oak Avenue", "arrive Oak Avenue"]);
    expect(right[1]!.bearingChange).toBeCloseTo(90, 3);
  });

  it("gives sharp turns and a U-turn", () => {
    const features = [
      ...cross,
      way(
        [
          [0.001, 0],
          [0, 0.001],
        ],
        { name: "Elm Road" },
      ),
      way(
        [
          [0.001, 0],
          [0, -0.001],
        ],
        { name: "Ash Road" },
      ),
      way(
        [
          [0.001, 0],
          [0, 0.00001],
        ],
        { name: "Spur Lane" },
      ),
    ];
    const graph = roadGraph(features, { mode: "walk" });
    const sharpLeft = routeSteps(graph, path(graph, A, B, "0.001,0"), { features });
    expect(sharpLeft[1]!.turn).toBe("sharp-left");
    expect(sharpLeft[1]!.bearingChange).toBeCloseTo(-135, 2);
    const sharpRight = routeSteps(graph, path(graph, A, B, "-0.001,0"), { features });
    expect(sharpRight[1]!.turn).toBe("sharp-right");
    expect(sharpRight[1]!.bearingChange).toBeCloseTo(135, 2);
    const back = routeSteps(graph, path(graph, A, B, "0.00001,0"), { features });
    expect(turns(back)).toEqual(["depart Main Street", "u-turn Spur Lane", "arrive Spur Lane"]);
    expect(Math.abs(back[1]!.bearingChange)).toBeGreaterThanOrEqual(TURN_DEGREES.sharp);
  });

  it("joins the edges of one road into one leg with the sum of their lengths", () => {
    const graph = roadGraph(cross, { mode: "walk" });
    const edges = path(graph, A, B, C);
    const steps = routeSteps(graph, edges, { features: cross });
    expect(turns(steps)).toEqual(["depart Main Street", "arrive Main Street"]);
    expect(steps[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
    expect(steps[0]!.meters).toBeCloseTo(graph.edges[edges[0]!]!.meters + graph.edges[edges[1]!]!.meters, 9);
    expect(steps[1]).toEqual({ turn: "arrive", bearingChange: 0, name: "Main Street", meters: 0, startIndex: 1, endIndex: 1 });
  });

  it("uses the bearing at the end of the last segment of the leg before", () => {
    // Bend Road goes east and then north. Pine Street goes east from its end, so the turn is to the right.
    const features = [
      way(
        [
          [0, 0],
          [0.001, 0],
          [0.001, 0.001],
        ],
        { name: "Bend Road" },
      ),
      way(
        [
          [0.001, 0.001],
          [0.002, 0.001],
        ],
        { name: "Pine Street" },
      ),
    ];
    const graph = roadGraph(features, { mode: "walk" });
    const steps = routeSteps(graph, path(graph, A, N, "0.001,0.002"), { features });
    expect(turns(steps)).toEqual(["depart Bend Road", "right Pine Street", "arrive Pine Street"]);
    expect(steps[1]!.bearingChange).toBeCloseTo(90, 3);
  });

  it("names an unnamed road by its ref, and a road with neither by an empty name", () => {
    const features = [
      way(
        [
          [0, 0],
          [0.001, 0],
        ],
        { name: "Main Street", ref: "A 1" },
      ),
      way(
        [
          [0.001, 0],
          [0.001, 0.001],
        ],
        { ref: "B 12" },
      ),
      way(
        [
          [0.001, 0.001],
          [0.002, 0.001],
        ],
        {},
      ),
    ];
    const graph = roadGraph(features, { mode: "walk" });
    const steps = routeSteps(graph, path(graph, A, B, N, "0.001,0.002"), { features });
    expect(steps.map((step) => [step.turn, step.name, step.ref])).toEqual([
      ["depart", "Main Street", "A 1"],
      ["left", "B 12", "B 12"],
      ["right", "", undefined],
      ["arrive", "", undefined],
    ]);
    expect("ref" in steps[2]!).toBe(false);
  });

  it("reads the tags with the tag reader, and the names with nameOf", () => {
    const features: Feature<LineString>[] = cross.map((feature, index) => ({
      ...feature,
      properties: { tags: feature.properties, label: index === 0 ? "Route 7" : "Route 9" },
    }));
    const graph = roadGraph(features, { mode: "walk" });
    const edges = path(graph, A, B, N);
    expect(turns(routeSteps(graph, edges, { features }))).toEqual(["depart Main Street", "left Oak Avenue", "arrive Oak Avenue"]);
    const nameOf = (feature: Feature): string => String((feature.properties as Record<string, unknown>)["label"]);
    expect(turns(routeSteps(graph, edges, { features, nameOf }))).toEqual(["depart Route 7", "left Route 9", "arrive Route 9"]);
    const tags = (): Record<string, unknown> => ({ name: "One Road" });
    expect(turns(routeSteps(graph, edges, { features, tags }))).toEqual(["depart One Road", "arrive One Road"]);
    expect(turns(routeSteps(graph, edges, { features: { type: "FeatureCollection", features } }))).toEqual([
      "depart Main Street",
      "left Oak Avenue",
      "arrive Oak Avenue",
    ]);
  });

  it("gives one unnamed leg with no features", () => {
    const graph = roadGraph(cross, { mode: "walk" });
    expect(turns(routeSteps(graph, path(graph, A, B, N)))).toEqual(["depart ", "arrive "]);
  });

  it("joins a short leg to its neighbors with the same name only with minLegMeters", () => {
    const features = [
      way(
        [
          [0, 0],
          [0.001, 0],
        ],
        { name: "Main Street" },
      ),
      way(
        [
          [0.001, 0],
          [0.0011, 0],
        ],
        { name: "Bridge" },
      ),
      way(
        [
          [0.0011, 0],
          [0.002, 0],
        ],
        { name: "Main Street" },
      ),
    ];
    const graph = roadGraph(features, { mode: "walk" });
    const edges = path(graph, A, B, "0,0.0011", C);
    expect(turns(routeSteps(graph, edges, { features }))).toEqual([
      "depart Main Street",
      "straight Bridge",
      "straight Main Street",
      "arrive Main Street",
    ]);
    const joined = routeSteps(graph, edges, { features, minLegMeters: 20 });
    expect(turns(joined)).toEqual(["depart Main Street", "arrive Main Street"]);
    expect(joined[0]).toMatchObject({ startIndex: 0, endIndex: 2 });
    expect(joined[0]!.meters).toBeCloseTo(edges.reduce((sum, e) => sum + graph.edges[e]!.meters, 0), 9);
    // A leg longer than the limit does not join.
    expect(routeSteps(graph, edges, { features, minLegMeters: 5 })).toHaveLength(4);
  });

  it("refuses an empty route, a bad edge and a bad minLegMeters", () => {
    const graph = roadGraph(cross, { mode: "walk" });
    expect(code(() => routeSteps(graph, []))).toBe("route");
    expect(code(() => routeSteps(graph, [999]))).toBe("route");
    expect(code(() => routeSteps(graph, path(graph, A, B).concat(path(graph, A, B))))).toBe("route");
    expect(code(() => routeSteps(graph, path(graph, A, B), { minLegMeters: -1 }))).toBe("tolerance");
    expect(code(() => routeSteps(graph, path(graph, A, B), { minLegMeters: Number.NaN }))).toBe("tolerance");
  });
});
