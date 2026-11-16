import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import { GeoError, locatePoint, pointLocator, type LatLon, type MultiPolygon, type Polygon, type Position } from "./index.ts";

type Geometry = Polygon | MultiPolygon;

/** This function gives the result of the work, or the code of its `GeoError`. */
function outcome(work: () => string): string {
  try {
    return work();
  } catch (error) {
    if (error instanceof GeoError) return `error ${error.code}`;
    throw error;
  }
}

/** A value on a grid of 1/8 steps from -8 to 8. Positions and points often share a value, so ties are frequent. */
const eighth = fc.integer({ min: -64, max: 64 }).map((n) => n / 8);

/** A closed ring of 3 to 30 positions with coordinates from the arbitrary. */
const ringOf = (coordinate: fc.Arbitrary<number>): fc.Arbitrary<Position[]> =>
  fc.array(fc.tuple(coordinate, coordinate), { minLength: 3, maxLength: 30 }).map((positions) => [...positions, positions[0] as Position]);

const coarseRing = ringOf(eighth);
const fineRing = ringOf(uniformDouble({ min: -8, max: 8 }));

/** A ring near the north pole: its latitudes are from 82 to 90 on a grid of 1/16 steps, so some positions are at the pole. */
const polarRing = coarseRing.map((ring) => ring.map(([x, y]): Position => [x, y / 2 + 86]));

/** A ring moved by 0, 360 or -360 on the x axis, so some rings cross the antimeridian in the plane of the tests. */
const movedRing = fc
  .tuple(fc.oneof(coarseRing, fineRing, polarRing), fc.constantFrom(0, 0, 360, -360))
  .map(([ring, dx]) => ring.map(([x, y]): Position => [x + dx, y]));

/** The rings of one polygon: the exterior and 0 to 2 holes. A hole is a random ring, so it can cross the exterior. */
const polygonRings = fc.tuple(movedRing, fc.array(fc.oneof(coarseRing, fineRing), { maxLength: 2 })).map(([exterior, holes]) => [exterior, ...holes]);

const geometry: fc.Arbitrary<Geometry> = fc.oneof(
  polygonRings.map((coordinates): Polygon => ({ type: "Polygon", coordinates })),
  fc.array(polygonRings, { minLength: 1, maxLength: 3 }).map((coordinates): MultiPolygon => ({ type: "MultiPolygon", coordinates })),
);

/** A point on the grid of 1/16 steps, a point with fine bits, or one of them moved by 360 or -360. */
const extraPoint: fc.Arbitrary<LatLon> = fc
  .tuple(
    fc.oneof(
      fc.record({ lat: eighth.map((v) => v / 2), lon: eighth.map((v) => v / 2) }),
      fc.record({ lat: uniformDouble({ min: -9, max: 9 }), lon: uniformDouble({ min: -9, max: 9 }) }),
      fc.record({ lat: eighth.map((v) => v / 2 + 86), lon: eighth }),
    ),
    fc.constantFrom(0, 360, -360),
  )
  .map(([point, dx]) => ({ lat: point.lat, lon: point.lon + dx }));

/** The rings of a geometry. */
const ringsOf = (polygon: Geometry): readonly (readonly Position[])[] =>
  polygon.type === "Polygon" ? polygon.coordinates : polygon.coordinates.flat();

/** The points of a test: the extra points, the poles, and the vertices and the middles of the edges of each ring. */
function pointsOf(polygon: Geometry, extra: readonly LatLon[]): LatLon[] {
  const points: LatLon[] = [...extra, { lat: 90, lon: 0 }, { lat: -90, lon: 0 }];
  for (const ring of ringsOf(polygon)) {
    for (let index = 0; index + 1 < ring.length; index += 1) {
      const [ax, ay] = ring[index] as Position;
      const [bx, by] = ring[index + 1] as Position;
      points.push({ lat: ay, lon: ax }, { lat: (ay + by) / 2, lon: (ax + bx) / 2 });
    }
  }
  return points;
}

/** The value one or more float steps above or below `v`. */
const nudge = (v: number, direction: 1 | -1): number => v + direction * Math.max(Math.abs(v) * 2 ** -52, 2 ** -1074);

/** A rough ring of `count` positions around the center, with fine bits, as a coast. */
function coast(count: number, cx: number, cy: number): Position[] {
  const ring: Position[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (2 * Math.PI * index) / count;
    const radius = 4 + 0.6 * Math.sin(37 * angle) + 0.3 * Math.sin(101 * angle + 1);
    ring.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return [...ring, ring[0] as Position];
}

describe("pointLocator", () => {
  it("gives the result of locatePoint for each point, with holes, parts, poles and the antimeridian", () => {
    fc.assert(
      fc.property(geometry, fc.array(extraPoint, { maxLength: 20 }), (polygon, extra) => {
        const locate = pointLocator(polygon);
        for (const point of pointsOf(polygon, extra)) {
          expect(outcome(() => locate(point)), JSON.stringify(point)).toBe(outcome(() => locatePoint(point, polygon)));
        }
      }),
      { numRuns: 200 },
    );
  });

  it("gives the result of locatePoint at the latitude of each vertex and one step above and below it", () => {
    const polygon: Polygon = { type: "Polygon", coordinates: [coast(1500, 10, 20), coast(300, 10.5, 20.25).map(([x, y]): Position => [10 + (x - 10) / 4, 20 + (y - 20) / 4])] };
    const locate = pointLocator(polygon);
    const seen = { inside: 0, boundary: 0, outside: 0 };
    let differ = 0;
    for (const ring of polygon.coordinates) {
      for (const [x, y] of ring) {
        for (const lat of [y, nudge(y, 1), nudge(y, -1)]) {
          for (const lon of [x, nudge(x, 1), 10]) {
            const point = { lat, lon };
            const expected = locatePoint(point, polygon);
            seen[expected] += 1;
            if (locate(point) !== expected) differ += 1;
          }
        }
      }
    }
    expect(differ).toBe(0);
    for (const where of ["inside", "boundary", "outside"] as const) expect(seen[where], where).toBeGreaterThan(0);
  });

  it("uses the rule of holes and the parts of a MultiPolygon", () => {
    const withHole: Polygon = {
      type: "Polygon",
      coordinates: [
        [[100, 0], [101, 0], [101, 1], [100, 1], [100, 0]],
        [[100.8, 0.8], [100.8, 0.2], [100.2, 0.2], [100.2, 0.8], [100.8, 0.8]],
      ],
    };
    const locate = pointLocator(withHole);
    expect(locate({ lat: 0.1, lon: 100.1 })).toBe("inside");
    expect(locate({ lat: 0.5, lon: 100.5 })).toBe("outside");
    expect(locate({ lat: 0.5, lon: 100.8 })).toBe("boundary");
    expect(locate({ lat: 0.5, lon: 100.5 - 360 })).toBe("outside");
    // A hole that crosses the exterior: the even-odd rule over all rings, as in locatePoint.
    const crossing: Polygon = {
      type: "Polygon",
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[2, 1], [6, 1], [6, 3], [2, 3], [2, 1]],
      ],
    };
    const inCrossing = pointLocator(crossing);
    const expected = { "1,2": "inside", "3,2": "outside", "5,2": "inside", "5,1": "boundary", "3,1": "boundary", "3,3.5": "inside" };
    for (const [key, where] of Object.entries(expected)) {
      const [lon, lat] = key.split(",").map(Number) as [number, number];
      expect(locatePoint({ lat, lon }, crossing), key).toBe(where);
      expect(inCrossing({ lat, lon }), key).toBe(where);
    }
    // The polygon from 170 E to 170 W, cut at the antimeridian into two parts (RFC 7946, section 3.1.9).
    const cut: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [[[180, 40], [180, 50], [170, 50], [170, 40], [180, 40]]],
        [[[-170, 40], [-170, 50], [-180, 50], [-180, 40], [-170, 40]]],
      ],
    };
    const inCut = pointLocator(cut);
    expect(inCut({ lat: 45, lon: 175 })).toBe("inside");
    expect(inCut({ lat: 45, lon: -175 })).toBe("inside");
    expect(inCut({ lat: 45, lon: 180 })).toBe("boundary");
    expect(inCut({ lat: 45, lon: 0 })).toBe("outside");
  });

  it("copies the positions, so a later change of the polygon does not change it", () => {
    const ring: Position[] = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const polygon: Polygon = { type: "Polygon", coordinates: [ring] };
    const locate = pointLocator(polygon);
    (ring[2] as unknown as number[])[0] = 1;
    (ring[2] as unknown as number[])[1] = 1;
    expect(locate({ lat: 9, lon: 9 })).toBe("inside");
    expect(locate({ lat: 10, lon: 10 })).toBe("boundary");
  });

  it("refuses an incorrect polygon, and its locator refuses an incorrect point", () => {
    expect(() => pointLocator({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] })).toThrow(GeoError);
    expect(outcome(() => String(pointLocator({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] })))).toBe("error ring-not-closed");
    const locate = pointLocator({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
    expect(outcome(() => locate({ lat: 91, lon: 0 }))).toBe("error latitude-range");
    expect(outcome(() => locate({ lat: Number.NaN, lon: 0 }))).toBe("error not-finite");
  });
});
