import { describe, expect, it } from "vitest";
import { GeoError } from "./errors.ts";
import type { Feature, LineString, MultiLineString } from "./geojson.ts";
import type { Position } from "./point.ts";
import { DRIVE, nearestNode, roadGraph, routeLine, snapToRoad, WALK, wayAccess, type RoadEdge, type RoadGraph, type TravelMode } from "./roads.ts";
import { distanceMeters } from "./sphere.ts";

// The coordinates and the ways are made up: a small grid in the ocean near the point (0, 0). A step of 0.001 degrees
// is approximately 111 metres.

function way(coordinates: Position[], tags: Record<string, string> = { highway: "residential" }, id?: number): Feature<LineString> {
  return { type: "Feature", geometry: { type: "LineString", coordinates }, properties: tags, ...(id === undefined ? {} : { id }) };
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

function pairs(graph: RoadGraph): string[] {
  return graph.edges.map((edge) => `${edge.from} > ${edge.to}`);
}

const A = "0,0";
const B = "0,0.001";
const C = "0,0.002";
const N = "0.001,0.001";
const S = "-0.001,0.001";

// A street from west to east, and a street from south to north that meets it at B.
const cross = [
  way([
    [0, 0],
    [0.001, 0],
    [0.002, 0],
  ]),
  way([
    [0.001, -0.001],
    [0.001, 0],
    [0.001, 0.001],
  ]),
];

/** A small search of Dijkstra on directed edges with `from`, `to` and `weight`, with no heap. */
function dijkstra(edges: readonly { readonly from: string; readonly to: string; readonly weight: number }[], from: string, to: string): number[] | undefined {
  const cost = new Map<string, number>([[from, 0]]);
  const via = new Map<string, number>();
  const done = new Set<string>();
  for (;;) {
    let node: string | undefined;
    for (const [key, value] of cost) if (!done.has(key) && (node === undefined || value < cost.get(node)!)) node = key;
    if (node === undefined) return undefined;
    if (node === to) break;
    done.add(node);
    edges.forEach((edge, index) => {
      if (edge.from !== node) return;
      const next = cost.get(node)! + edge.weight;
      if (next < (cost.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        cost.set(edge.to, next);
        via.set(edge.to, index);
      }
    });
  }
  const path: number[] = [];
  for (let node = to; node !== from; node = edges[path.at(-1)!]!.from) path.push(via.get(node)!);
  return path.reverse();
}

describe("wayAccess", () => {
  it("opens a road of the table in the two directions", () => {
    expect(wayAccess({ highway: "residential" }, "drive")).toBe("both");
    expect(wayAccess({ highway: "residential" }, WALK)).toBe("both");
  });

  it("closes a highway value that is not in the table of the mode", () => {
    expect(wayAccess({ highway: "footway" }, "drive")).toBe("closed");
    expect(wayAccess({ highway: "motorway" }, "walk")).toBe("closed");
    expect(wayAccess({ building: "yes" }, "walk")).toBe("closed");
    expect(wayAccess(null, "walk")).toBe("closed");
  });

  it("closes a way with access=no or access=private, unless a more specific tag opens it", () => {
    expect(wayAccess({ highway: "service", access: "private" }, "drive")).toBe("closed");
    expect(wayAccess({ highway: "service", access: "no" }, "walk")).toBe("closed");
    expect(wayAccess({ highway: "service", access: "private", foot: "yes" }, "walk")).toBe("both");
    expect(wayAccess({ highway: "service", access: "private", foot: "yes" }, "drive")).toBe("closed");
    expect(wayAccess({ highway: "residential", motor_vehicle: "no" }, "drive")).toBe("closed");
    expect(wayAccess({ highway: "residential", motor_vehicle: "no" }, "walk")).toBe("both");
  });

  it("applies oneway to drive and not to walk", () => {
    expect(wayAccess({ highway: "residential", oneway: "yes" }, "drive")).toBe("forward");
    expect(wayAccess({ highway: "residential", oneway: "yes" }, "walk")).toBe("both");
    expect(wayAccess({ highway: "residential", oneway: "-1" }, "drive")).toBe("backward");
    expect(wayAccess({ highway: "residential", oneway: "reverse" }, "drive")).toBe("backward");
    expect(wayAccess({ highway: "residential", oneway: "no" }, "drive")).toBe("both");
    expect(wayAccess({ highway: "residential", oneway: " Yes " }, "drive")).toBe("forward");
    expect(wayAccess({ highway: "residential", oneway: true }, "drive")).toBe("forward");
  });

  it("applies oneway:foot to walk", () => {
    expect(wayAccess({ highway: "footway", "oneway:foot": "yes" }, "walk")).toBe("forward");
    expect(wayAccess({ highway: "footway", "oneway:foot": "-1" }, "walk")).toBe("backward");
  });

  it("makes a roundabout and a motorway one-way for drive, unless a oneway tag says no", () => {
    expect(wayAccess({ highway: "primary", junction: "roundabout" }, "drive")).toBe("forward");
    expect(wayAccess({ highway: "motorway" }, "drive")).toBe("forward");
    expect(wayAccess({ highway: "primary", junction: "roundabout", oneway: "no" }, "drive")).toBe("both");
    expect(wayAccess({ highway: "primary", junction: "roundabout" }, "walk")).toBe("both");
  });

  it("uses the table of the caller", () => {
    const bike: TravelMode = { ...WALK, name: "bike", highways: ["cycleway"], access: ["bicycle", "access"], oneway: ["oneway:bicycle", "oneway"] };
    expect(wayAccess({ highway: "cycleway", oneway: "yes" }, bike)).toBe("forward");
    expect(wayAccess({ highway: "cycleway", oneway: "yes", "oneway:bicycle": "no" }, bike)).toBe("both");
    expect(wayAccess({ highway: "footway" }, bike)).toBe("closed");
  });

  it("refuses a travel mode that it does not know", () => {
    expect(code(() => wayAccess({ highway: "road" }, "fly" as "walk"))).toBe("travel-mode");
    expect(code(() => wayAccess({ highway: "road" }, "toString" as "walk"))).toBe("travel-mode");
    expect(code(() => wayAccess({ highway: "road" }, { ...DRIVE, highways: "road" } as unknown as TravelMode))).toBe("travel-mode");
  });
});

describe("roadGraph", () => {
  it("makes a node at a shared position and at each end, and an edge in each direction", () => {
    const graph = roadGraph(cross, { mode: "drive" });
    expect([...graph.nodes.keys()]).toEqual([A, B, C, S, N]);
    expect(pairs(graph)).toEqual([`${A} > ${B}`, `${B} > ${A}`, `${B} > ${C}`, `${C} > ${B}`, `${S} > ${B}`, `${B} > ${S}`, `${B} > ${N}`, `${N} > ${B}`]);
    expect(graph.mode).toBe("drive");
    expect(graph.nodes.get(B)!.point).toEqual({ lat: 0, lon: 0.001 });
  });

  it("gives each edge its length in metres, its line and the same segment for the two directions", () => {
    const graph = roadGraph(cross, { mode: "drive" });
    const [forward, backward] = graph.edges as [RoadEdge, RoadEdge];
    const meters = distanceMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 });
    expect(forward.meters).toBeCloseTo(meters, 9);
    expect(forward.meters).toBeCloseTo(111.19, 1);
    expect(forward.weight).toBe(forward.meters);
    expect(forward.line).toEqual([
      [0, 0],
      [0.001, 0],
    ]);
    expect(backward.line).toEqual([
      [0.001, 0],
      [0, 0],
    ]);
    expect([forward.segment, backward.segment, forward.feature]).toEqual([0, 0, 0]);
    expect(graph.edges[4]!.feature).toBe(1);
  });

  it("makes no junction where two ways cross with no shared position, as at a bridge", () => {
    const bridge = way(
      [
        [0.0015, -0.001],
        [0.0015, 0.001],
      ],
      { highway: "primary", bridge: "yes", layer: "1" },
    );
    const graph = roadGraph([cross[0]!, bridge], { mode: "drive" });
    expect(graph.nodes.size).toBe(4);
    expect(pairs(graph)).toEqual([`${A} > ${C}`, `${C} > ${A}`, "-0.001,0.0015 > 0.001,0.0015", "0.001,0.0015 > -0.001,0.0015"]);
    expect(graph.edges[0]!.line).toHaveLength(3);
  });

  it("follows oneway=yes and oneway=-1 for drive, in each direction", () => {
    const forward = roadGraph([way(cross[0]!.geometry.coordinates as Position[], { highway: "residential", oneway: "yes" })], { mode: "drive" });
    expect(pairs(forward)).toEqual([`${A} > ${C}`]);
    const backward = roadGraph([way(cross[0]!.geometry.coordinates as Position[], { highway: "residential", oneway: "-1" })], { mode: "drive" });
    expect(pairs(backward)).toEqual([`${C} > ${A}`]);
    expect(backward.edges[0]!.line[0]).toEqual([0.002, 0]);
    const walk = roadGraph([way(cross[0]!.geometry.coordinates as Position[], { highway: "residential", oneway: "-1" })], { mode: "walk" });
    expect(pairs(walk)).toEqual([`${A} > ${C}`, `${C} > ${A}`]);
  });

  it("goes around a one-way street, and takes it in its direction", () => {
    // The direct street from A to C is one-way to the west. A loop through the north goes from A to C.
    const ways = [
      way(
        [
          [0, 0],
          [0.002, 0],
        ],
        { highway: "residential", oneway: "-1" },
      ),
      way([
        [0, 0],
        [0, 0.001],
        [0.002, 0.001],
        [0.002, 0],
      ]),
    ];
    const graph = roadGraph(ways, { mode: "drive" });
    const east = dijkstra(graph.edges, A, C)!;
    expect(east.map((index) => graph.edges[index]!.feature)).toEqual([1]);
    const west = dijkstra(graph.edges, C, A)!;
    expect(west.map((index) => graph.edges[index]!.feature)).toEqual([0]);
    expect(routeLine(graph, east).meters).toBeGreaterThan(routeLine(graph, west).meters);
  });

  it("excludes access=private, and keeps it for walk when foot=yes", () => {
    const ways = [cross[0]!, way(cross[1]!.geometry.coordinates as Position[], { highway: "service", access: "private", foot: "yes" })];
    expect(pairs(roadGraph(ways, { mode: "drive" }))).toEqual([`${A} > ${C}`, `${C} > ${A}`]);
    expect(roadGraph(ways, { mode: "walk" }).edges).toHaveLength(8);
  });

  it("gives a different graph for walk and drive", () => {
    const ways = [
      cross[0]!,
      way(cross[1]!.geometry.coordinates as Position[], { highway: "footway" }),
      way(
        [
          [0.002, 0],
          [0.003, 0],
        ],
        { highway: "motorway" },
      ),
    ];
    const walk = roadGraph(ways, { mode: "walk" });
    const drive = roadGraph(ways, { mode: "drive" });
    expect(walk.edges.map((edge) => edge.feature)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(drive.edges.map((edge) => edge.feature)).toEqual([0, 0, 2]);
    expect(pairs(drive).at(-1)).toBe(`${C} > 0,0.003`);
  });

  it("reads the tags under properties.tags, or with a function of the caller", () => {
    const nested: Feature = { ...cross[0]!, properties: { id: 7, tags: { highway: "footway" } } };
    expect(roadGraph([nested], { mode: "walk" }).edges).toHaveLength(2);
    expect(roadGraph([nested], { mode: "drive" }).edges).toHaveLength(0);
    expect(roadGraph([nested], { mode: "drive", tags: () => ({ highway: "primary" }) }).edges).toHaveLength(2);
  });

  it("joins two ways at the same node identifier with the vertexKey of the caller", () => {
    // The two ways have the node 2 in common, with positions that differ a little.
    const first = { ...way([[0, 0], [0.001, 0]]), properties: { highway: "residential", nodes: [1, 2] } };
    const second = { ...way([[0.0010000001, 0], [0.002, 0]]), properties: { highway: "residential", nodes: [2, 3] } };
    const byPosition = roadGraph([first, second], { mode: "drive" });
    expect(byPosition.nodes.size).toBe(4);
    const byNode = roadGraph([first, second], {
      mode: "drive",
      vertexKey: (_position, feature, index) => `n${(feature.properties!["nodes"] as number[])[index]}`,
    });
    expect([...byNode.nodes.keys()]).toEqual(["n1", "n2", "n3"]);
    expect(dijkstra(byNode.edges, "n1", "n3")).toEqual([0, 2]);
  });

  it("splits a closed way at its junctions, and gives no edge for a loop with no junction", () => {
    const ring = way([
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0],
    ]);
    expect(roadGraph([ring], { mode: "drive" }).edges).toHaveLength(0);
    const spur = way([
      [0.001, 0],
      [0.002, 0],
    ]);
    const graph = roadGraph([ring, spur], { mode: "drive" });
    expect(pairs(graph)).toEqual([`${A} > ${B}`, `${B} > ${A}`, `${B} > ${A}`, `${A} > ${B}`, `${B} > ${C}`, `${C} > ${B}`]);
    expect(graph.edges[2]!.line).toHaveLength(3);
  });

  it("reads each part of a MultiLineString, and skips two equal positions next to each other", () => {
    const multi: Feature<MultiLineString> = {
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: [
          [
            [0, 0],
            [0, 0],
            [0.001, 0],
          ],
          [
            [0.001, 0],
            [0.002, 0],
          ],
        ],
      },
      properties: { highway: "residential" },
    };
    const graph = roadGraph({ type: "FeatureCollection", features: [multi] }, { mode: "drive" });
    expect(pairs(graph)).toEqual([`${A} > ${B}`, `${B} > ${A}`, `${B} > ${C}`, `${C} > ${B}`]);
    expect(graph.edges[0]!.line).toHaveLength(2);
  });

  it("skips a feature that is not a line, and refuses a bad position or input", () => {
    const point: Feature = { type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { highway: "residential" } };
    const empty: Feature = { type: "Feature", geometry: null, properties: { highway: "residential" } };
    expect(roadGraph([point, empty], { mode: "walk" }).nodes.size).toBe(0);
    expect(code(() => roadGraph([way([[0, 0], [Number.NaN, 0]])], { mode: "walk" }))).toBe("not-finite");
    expect(code(() => roadGraph([way([[0, 0], [0, 91]])], { mode: "walk" }))).toBe("latitude-range");
    expect(code(() => roadGraph([way([[0, 0]])], { mode: "walk" }))).toBe("too-few-positions");
    expect(code(() => roadGraph({} as never, { mode: "walk" }))).toBe("geojson-member");
    expect(code(() => roadGraph(cross, { mode: "boat" as "walk" }))).toBe("travel-mode");
  });

  it("gives the same graph for the same input, and does not change the input", () => {
    const frozen = structuredClone(cross).map((feature) => Object.freeze(feature));
    expect(roadGraph(frozen, { mode: "walk" })).toEqual(roadGraph(cross, { mode: "walk" }));
    expect(frozen).toEqual(cross);
  });
});

describe("nearestNode and snapToRoad", () => {
  const graph = roadGraph(cross, { mode: "drive" });

  it("gives the nearest node and its distance", () => {
    const near = nearestNode(graph, { lat: 0.0001, lon: 0.0019 })!;
    expect(near.node.id).toBe(C);
    expect(near.meters).toBeCloseTo(distanceMeters({ lat: 0.0001, lon: 0.0019 }, { lat: 0, lon: 0.002 }), 9);
    expect(nearestNode(roadGraph([], { mode: "walk" }), { lat: 0, lon: 0 })).toBeUndefined();
    expect(code(() => nearestNode(graph, { lat: 0 } as never))).toBe("not-a-point");
  });

  it("cuts the nearest edge at the nearest point, in the two directions", () => {
    // The point is 0.0002 degrees (approximately 22 m) north of the middle of the street from A to B.
    const snap = snapToRoad(graph, { lat: 0.0002, lon: 0.0005 })!;
    expect(snap.split).toBe(true);
    expect(snap.node.point.lat).toBeCloseTo(0, 9);
    expect(snap.node.point.lon).toBeCloseTo(0.0005, 9);
    expect(snap.meters).toBeCloseTo(22.1, 0);
    const id = snap.node.id;
    expect(pairs(snap.graph).slice(0, 4)).toEqual([`${A} > ${id}`, `${id} > ${B}`, `${B} > ${id}`, `${id} > ${A}`]);
    expect(snap.graph.edges).toHaveLength(graph.edges.length + 2);
    expect(snap.graph.nodes.get(id)).toBe(snap.node);
    const [head, tail] = snap.graph.edges as [RoadEdge, RoadEdge];
    expect(head.meters + tail.meters).toBeCloseTo(graph.edges[0]!.meters, 6);
    expect(head.segment).toBe(graph.edges[0]!.segment);
    expect(head.line.at(-1)).toEqual(tail.line[0]);
    // The input graph does not change.
    expect(graph.edges).toHaveLength(8);
    expect(graph.nodes.has(id)).toBe(false);
    // A route from the new node goes along the cut edges.
    const path = dijkstra(snap.graph.edges, id, C)!;
    expect(routeLine(snap.graph, path).meters).toBeCloseTo(graph.edges[0]!.meters / 2 + graph.edges[2]!.meters, 2);
  });

  it("cuts only the one direction of a one-way street", () => {
    const oneWay = roadGraph([way(cross[0]!.geometry.coordinates as Position[], { highway: "residential", oneway: "yes" })], { mode: "drive" });
    const snap = snapToRoad(oneWay, { lat: -0.0001, lon: 0.0013 })!;
    expect(snap.split).toBe(true);
    expect(pairs(snap.graph)).toEqual([`${A} > ${snap.node.id}`, `${snap.node.id} > ${C}`]);
    expect(snap.graph.edges[0]!.line).toEqual([[0, 0], [0.001, 0], snap.graph.edges[0]!.line[2]]);
  });

  it("gives a node with no cut when the node is the nearest point", () => {
    const snap = snapToRoad(graph, { lat: 0.0003, lon: 0.0023 })!;
    expect(snap).toMatchObject({ split: false, node: { id: C } });
    expect(snap.graph).toBe(graph);
    expect(snap.meters).toBeCloseTo(nearestNode(graph, { lat: 0.0003, lon: 0.0023 })!.meters, 0);
  });

  it("gives the end of the edge for a nearest point within the tolerance", () => {
    // The nearest point is 0.3 m from B on the street from A to B, and the point is 5.5 m south of the street.
    const point = { lat: -0.00005, lon: 0.001 - 0.3 / 111_195 };
    const snap = snapToRoad(roadGraph([cross[0]!, way([[0.001, 0], [0.001, 0.001]])], { mode: "drive" }), point)!;
    expect(snap.split).toBe(false);
    expect(snap.node.id).toBe(B);
    const cut = snapToRoad(roadGraph([cross[0]!], { mode: "drive" }), { lat: 0.0005, lon: 0.0015 }, { toleranceMeters: 0, id: "here" })!;
    expect(cut.node.id).toBe("here");
    expect(code(() => snapToRoad(graph, point, { toleranceMeters: -1 }))).toBe("tolerance");
    expect(snapToRoad(roadGraph([], { mode: "walk" }), point)).toBeUndefined();
  });
});

describe("routeLine", () => {
  const graph = roadGraph(cross, { mode: "drive" });

  it("joins the lines of the edges, with each common position one time", () => {
    // From A east to B, then north to N.
    const route = routeLine(graph, [0, 6]);
    expect(route.line).toEqual({
      type: "LineString",
      coordinates: [
        [0, 0],
        [0.001, 0],
        [0.001, 0.001],
      ],
    });
    expect(route.meters).toBe(graph.edges[0]!.meters + graph.edges[6]!.meters);
  });

  it("refuses no edges, an index that is not an edge, and two edges that do not join", () => {
    expect(code(() => routeLine(graph, []))).toBe("route");
    expect(code(() => routeLine(graph, [99]))).toBe("route");
    expect(code(() => routeLine(graph, [0.5]))).toBe("route");
    expect(code(() => routeLine(graph, [0, 0]))).toBe("route");
  });
});
