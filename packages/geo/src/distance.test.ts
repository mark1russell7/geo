import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import {
  EARTH_MEAN_RADIUS_KM,
  GeoError,
  distanceKm,
  distanceToGeometryKm,
  distanceToGeometryMeters,
  locatePoint,
  type Geometry,
  type LatLon,
  type LineString,
  type Polygon,
  type Position,
} from "./index.ts";

/** The length of an arc of the sphere in kilometres, for an angle in degrees. */
const km = (degrees: number): number => (degrees * Math.PI * EARTH_MEAN_RADIUS_KM) / 180;

const square = (west: number, south: number, east: number, north: number): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

const line = (...positions: Position[]): LineString => ({ type: "LineString", coordinates: positions });

const codeOf = (run: () => unknown): { code: string; path: string } => {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return { code: error.code, path: error.path };
    throw error;
  }
  throw new Error("The function did not throw");
};

describe("the distance to a point", () => {
  it("is the great-circle distance", () => {
    const a = { lat: 10, lon: 20 };
    const b = { lat: -30, lon: 140 };
    expect(distanceToGeometryKm(a, { type: "Point", coordinates: [b.lon, b.lat] })).toBeCloseTo(distanceKm(a, b), 9);
  });

  it("is 0 for the same point, also with a longitude moved by 360 and at a pole", () => {
    expect(distanceToGeometryKm({ lat: 10, lon: 20 }, { type: "Point", coordinates: [380, 10] })).toBe(0);
    expect(distanceToGeometryKm({ lat: 10, lon: -180 }, { type: "Point", coordinates: [180, 10] })).toBe(0);
    expect(distanceToGeometryKm({ lat: 90, lon: 0 }, { type: "Point", coordinates: [123, 90] })).toBe(0);
  });

  it("is the smallest distance to the points of a MultiPoint", () => {
    const from = { lat: 0, lon: 0 };
    const points: Geometry = { type: "MultiPoint", coordinates: [[30, 0], [0, -12], [-20, 0]] };
    expect(distanceToGeometryKm(from, points)).toBeCloseTo(km(12), 9);
  });
});

describe("the distance to a line", () => {
  it("is the distance along the equator to the nearest end", () => {
    const equator = line([10, 0], [20, 0]);
    expect(distanceToGeometryKm({ lat: 0, lon: 0 }, equator)).toBeCloseTo(km(10), 9);
    expect(distanceToGeometryKm({ lat: 0, lon: 25 }, equator)).toBeCloseTo(km(5), 9);
    expect(distanceToGeometryKm({ lat: 0, lon: -170 }, equator)).toBeCloseTo(km(170), 9);
  });

  it("is the difference of the latitudes for a point on the meridian of the middle of a parallel", () => {
    const parallel = line([-10, 60], [10, 60]);
    expect(distanceToGeometryKm({ lat: 70, lon: 0 }, parallel)).toBeCloseTo(km(10), 9);
    expect(distanceToGeometryKm({ lat: 50, lon: 0 }, parallel)).toBeCloseTo(km(10), 9);
    expect(distanceToGeometryKm({ lat: -30, lon: 0 }, parallel)).toBeCloseTo(km(90), 9);
  });

  it("is the distance to the foot on a meridian", () => {
    // The nearest point of a meridian to a point on the equator is on the equator.
    expect(distanceToGeometryKm({ lat: 0, lon: 25 }, line([20, -5], [20, 5]))).toBeCloseTo(km(5), 9);
  });

  it("is 0 only for a point on the line", () => {
    const diagonal = line([0, 0], [2, 2], [4, 0]);
    expect(distanceToGeometryKm({ lat: 1, lon: 1 }, diagonal)).toBe(0);
    expect(distanceToGeometryKm({ lat: 0.5, lon: 3.5 }, diagonal)).toBe(0);
    const near = distanceToGeometryKm({ lat: 1, lon: 1 + 2 ** -40 }, diagonal);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1e-6);
  });

  it("finds a point on a line that crosses the antimeridian", () => {
    const crossing = line([170, 0], [190, 10]);
    expect(distanceToGeometryKm({ lat: 5, lon: -180 }, crossing)).toBe(0);
    expect(distanceToGeometryKm({ lat: 5, lon: 180 }, crossing)).toBe(0);
    expect(distanceToGeometryKm({ lat: 0, lon: -175 }, line([175, 0], [185, 0]))).toBe(0);
  });

  it("finds a pole on a line that touches the pole", () => {
    expect(distanceToGeometryKm({ lat: 90, lon: 45 }, line([0, 80], [0, 90]))).toBe(0);
    expect(distanceToGeometryKm({ lat: 85, lon: 180 }, line([0, 80], [0, 90]))).toBeCloseTo(km(5), 9);
  });
});

describe("the distance to a polygon", () => {
  const area = square(10, -5, 20, 5);

  it("is 0 inside and on the boundary", () => {
    expect(distanceToGeometryKm({ lat: 0, lon: 15 }, area)).toBe(0);
    expect(distanceToGeometryKm({ lat: 5, lon: 12 }, area)).toBe(0);
    expect(distanceToGeometryKm({ lat: -5, lon: 20 }, area)).toBe(0);
  });

  it("is the distance to the nearest edge outside", () => {
    expect(distanceToGeometryKm({ lat: 0, lon: 25 }, area)).toBeCloseTo(km(5), 9);
    expect(distanceToGeometryKm({ lat: 0, lon: 0 }, area)).toBeCloseTo(km(10), 9);
  });

  it("is more than 0 for a point very near the boundary outside", () => {
    const d = distanceToGeometryKm({ lat: 0, lon: 20 + 2 ** -45 }, area);
    expect(locatePoint({ lat: 0, lon: 20 + 2 ** -45 }, area)).toBe("outside");
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1e-9);
    expect(distanceToGeometryKm({ lat: 0, lon: 20 + 2 ** -45 }, area, 1e-300)).toBeGreaterThan(0);
  });

  it("is the distance to the edge of a hole for a point in the hole", () => {
    const withHole: Polygon = { type: "Polygon", coordinates: [...square(0, -10, 30, 10).coordinates, ...area.coordinates] };
    expect(distanceToGeometryKm({ lat: 0, lon: 18 }, withHole)).toBeCloseTo(km(2), 9);
    expect(distanceToGeometryKm({ lat: 0, lon: 20 }, withHole)).toBe(0);
    expect(distanceToGeometryKm({ lat: 0, lon: 25 }, withHole)).toBe(0);
  });

  it("works across the antimeridian, in the two written forms", () => {
    const past180 = square(170, -5, 190, 5);
    const cut: Geometry = { type: "MultiPolygon", coordinates: [square(170, -5, 180, 5).coordinates, square(-180, -5, -170, 5).coordinates] };
    for (const polygon of [past180, cut]) {
      expect(distanceToGeometryKm({ lat: 0, lon: -175 }, polygon)).toBe(0);
      expect(distanceToGeometryKm({ lat: 0, lon: 175 }, polygon)).toBe(0);
      expect(distanceToGeometryKm({ lat: 0, lon: -165 }, polygon)).toBeCloseTo(km(5), 9);
      expect(distanceToGeometryKm({ lat: 0, lon: 160 }, polygon)).toBeCloseTo(km(10), 9);
    }
  });

  it("works for a polygon around a pole", () => {
    const cap = square(-180, 80, 180, 90);
    expect(distanceToGeometryKm({ lat: 85, lon: 33 }, cap)).toBe(0);
    expect(distanceToGeometryKm({ lat: 90, lon: 33 }, cap)).toBe(0);
    expect(distanceToGeometryKm({ lat: 70, lon: 33 }, cap)).toBeCloseTo(km(10), 9);
    expect(distanceToGeometryKm({ lat: -90, lon: 0 }, cap)).toBeCloseTo(km(170), 9);
  });
});

describe("the distance to a collection", () => {
  it("is the smallest distance to its members, also nested", () => {
    const collection: Geometry = {
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [40, 0] },
        { type: "GeometryCollection", geometries: [square(10, -5, 20, 5)] },
      ],
    };
    expect(distanceToGeometryKm({ lat: 0, lon: 30 }, collection)).toBeCloseTo(km(10), 9);
    expect(distanceToGeometryKm({ lat: 0, lon: 15 }, collection)).toBe(0);
  });

  it("is Infinity for a geometry with no position", () => {
    const from = { lat: 0, lon: 0 };
    expect(distanceToGeometryKm(from, { type: "GeometryCollection", geometries: [] })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToGeometryKm(from, { type: "MultiPoint", coordinates: [] })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToGeometryKm(from, line())).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToGeometryKm(from, { type: "Polygon", coordinates: [] })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceToGeometryKm(from, { type: "MultiLineString", coordinates: [[]] })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the units and the radius", () => {
  it("gives metres as kilometres times 1000, and scales with the radius", () => {
    const from = { lat: 12, lon: -40 };
    const area = square(10, -5, 20, 5);
    const inKm = distanceToGeometryKm(from, area);
    expect(distanceToGeometryMeters(from, area)).toBeCloseTo(inKm * 1000, 6);
    expect(distanceToGeometryKm(from, area, 1)).toBeCloseTo(inKm / EARTH_MEAN_RADIUS_KM, 12);
  });

  it("refuses a radius that is not more than 0", () => {
    const from = { lat: 0, lon: 0 };
    expect(codeOf(() => distanceToGeometryKm(from, line([0, 0], [1, 1]), 0)).code).toBe("radius");
    expect(codeOf(() => distanceToGeometryMeters(from, line([0, 0], [1, 1]), Number.NaN)).code).toBe("not-finite");
  });
});

describe("the errors", () => {
  const from = { lat: 0, lon: 0 };

  it("refuses an incorrect point", () => {
    expect(codeOf(() => distanceToGeometryKm({ lat: 91, lon: 0 }, line([0, 0], [1, 1]))).code).toBe("latitude-range");
  });

  it("refuses an incorrect geometry with the path of the fault", () => {
    const open = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } as Polygon;
    expect(codeOf(() => distanceToGeometryKm(from, open))).toEqual({ code: "ring-not-closed", path: "coordinates[0]" });
    expect(codeOf(() => distanceToGeometryKm(from, { type: "Circle" } as unknown as Geometry)).code).toBe("geojson-type");
  });

  it("refuses a longitude of a line or a polygon out of -540 to 540 at once, with its path", () => {
    const started = performance.now();
    expect(codeOf(() => distanceToGeometryKm(from, line([-1e12, 0], [1e12, 0])))).toEqual({
      code: "longitude-range",
      path: "coordinates[0]",
    });
    const nested: Geometry = {
      type: "GeometryCollection",
      geometries: [line([0, 0], [1, 1]), { type: "MultiPolygon", coordinates: [square(0, 0, 1, 1).coordinates, square(0, 0, 600, 1).coordinates] }],
    };
    expect(codeOf(() => distanceToGeometryKm(from, nested))).toEqual({
      code: "longitude-range",
      path: "geometries[1].coordinates[1][0][1]",
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("accepts a point of a geometry with any finite longitude", () => {
    expect(distanceToGeometryKm(from, { type: "Point", coordinates: [3600, 0] })).toBe(0);
  });
});

// The reference: the smallest distance over a dense sample of the edge, refined by a golden-section search near the
// best sample. It uses distanceKm, so it does not share the formula of the function under test.
const SAMPLES = 2000;

const pointAt = (a: Position, b: Position, u: number): LatLon => ({
  lat: Math.max(-90, Math.min(90, a[1] + u * (b[1] - a[1]))),
  lon: a[0] + u * (b[0] - a[0]),
});

function reference(from: LatLon, a: Position, b: Position): { sampled: number; refined: number; step: number } {
  const at = (u: number): number => distanceKm(from, pointAt(a, b, u));
  let bestIndex = 0;
  let sampled = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= SAMPLES; index += 1) {
    const d = at(index / SAMPLES);
    if (d < sampled) {
      sampled = d;
      bestIndex = index;
    }
  }
  let low = Math.max(0, (bestIndex - 1) / SAMPLES);
  let high = Math.min(1, (bestIndex + 1) / SAMPLES);
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let round = 0; round < 80; round += 1) {
    const p = high - ratio * (high - low);
    const q = low + ratio * (high - low);
    if (at(p) < at(q)) high = q;
    else low = p;
  }
  const refined = Math.min(sampled, at(low), at(high));
  const step = km(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLES);
  return { sampled, refined, step };
}

const lat = uniformDouble({ min: -90, max: 90 });
const lon = uniformDouble({ min: -180, max: 180 });
const polar = uniformDouble({ min: 75, max: 90 }).chain((value) => fc.constantFrom(value, 0 - value));

/** An edge: short, long, near a pole, or across the antimeridian. */
const edge: fc.Arbitrary<readonly [Position, Position]> = fc.oneof(
  fc.tuple(lat, lon, uniformDouble({ min: -2, max: 2 }), uniformDouble({ min: -2, max: 2 })).map(
    ([y, x, dy, dx]): readonly [Position, Position] => [[x, y], [x + dx, Math.max(-90, Math.min(90, y + dy))]],
  ),
  fc.tuple(lat, lon, lat, uniformDouble({ min: -200, max: 200 })).map(
    ([y, x, y2, dx]): readonly [Position, Position] => [[x, y], [x + dx, y2]],
  ),
  fc.tuple(polar, lon, polar, uniformDouble({ min: -180, max: 180 })).map(
    ([y, x, y2, dx]): readonly [Position, Position] => [[x, y], [x + dx, Math.sign(y2) === Math.sign(y) ? y2 : 0 - y2]],
  ),
  fc.tuple(lat, uniformDouble({ min: 170, max: 180 }), lat, uniformDouble({ min: 0, max: 30 })).map(
    ([y, x, y2, dx]): readonly [Position, Position] => [[x, y], [x + dx, y2]],
  ),
);

/** A viewer anywhere, or near a point of the edge. */
const viewerFor = ([a, b]: readonly [Position, Position]): fc.Arbitrary<LatLon> =>
  fc.oneof(
    fc.record({ lat, lon }),
    fc
      .tuple(uniformDouble({ min: 0, max: 1 }), uniformDouble({ min: -1, max: 1 }), uniformDouble({ min: -1, max: 1 }))
      .map(([u, dy, dx]) => {
        const on = pointAt(a, b, u);
        return { lat: Math.max(-90, Math.min(90, on.lat + dy)), lon: on.lon + dx };
      }),
  );

describe("the distance to an edge, against a dense reference", () => {
  it("is not more than the reference, and not less than the sample by more than half a step", () => {
    fc.assert(
      fc.property(
        edge.chain((ab) => fc.tuple(fc.constant(ab), viewerFor(ab))),
        ([[a, b], from]) => {
          const d = distanceToGeometryKm(from, line(a, b));
          const { sampled, refined, step } = reference(from, a, b);
          expect(d).toBeLessThanOrEqual(refined + 1e-7);
          expect(d).toBeGreaterThanOrEqual(sampled - step / 2 - 1e-7);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("does not change when the edge moves by 360", () => {
    fc.assert(
      fc.property(
        edge.chain((ab) => fc.tuple(fc.constant(ab), viewerFor(ab))),
        ([[a, b], from]) => {
          // The move goes against the sign of the edge, so the longitudes stay from -540 to 540.
          const shift = a[0] + b[0] > 0 ? -360 : 360;
          const moved = line([a[0] + shift, a[1]], [b[0] + shift, b[1]]);
          expect(distanceToGeometryKm(from, moved)).toBeCloseTo(distanceToGeometryKm(from, line(a, b)), 6);
        },
      ),
    );
  });
});

/** A coordinate on a grid of 1/8 steps from -8 to 8. */
const eighth = fc.integer({ min: -64, max: 64 }).map((n) => n / 8);
const gridPoint: fc.Arbitrary<LatLon> = fc.record({ lat: eighth, lon: eighth });
const coarseRing: fc.Arbitrary<Position[]> = fc
  .array(fc.tuple(eighth, eighth), { minLength: 3, maxLength: 6 })
  .map((positions) => [...positions, positions[0] as [number, number]]);

describe("the zero of the distance", () => {
  it("agrees with locatePoint for a polygon", () => {
    fc.assert(
      fc.property(coarseRing, gridPoint, (ring, from) => {
        const polygon: Polygon = { type: "Polygon", coordinates: [ring] };
        const d = distanceToGeometryKm(from, polygon);
        expect(d === 0).toBe(locatePoint(from, polygon) !== "outside");
        expect(d).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("is 0 for each vertex and for the middle of each edge of a line, and not 0 off the line", () => {
    const small = fc.integer({ min: -6, max: 6 });
    fc.assert(
      fc.property(fc.array(fc.tuple(small, small), { minLength: 2, maxLength: 5 }), small, small, (positions, y, x) => {
        const path = line(...positions);
        for (let index = 0; index + 1 < positions.length; index += 1) {
          const [ax, ay] = positions[index] as [number, number];
          const [bx, by] = positions[index + 1] as [number, number];
          expect(distanceToGeometryKm({ lat: ay, lon: ax }, path)).toBe(0);
          expect(distanceToGeometryKm({ lat: (ay + by) / 2, lon: (ax + bx) / 2 }, path)).toBe(0);
        }
        // The exact test of an integer point against each edge.
        const onEdge = positions.some((a, index) => {
          const b = positions[index + 1];
          if (b === undefined) return false;
          const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
          const inBox = Math.min(a[0], b[0]) <= x && x <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= y && y <= Math.max(a[1], b[1]);
          return cross === 0 && inBox;
        });
        expect(distanceToGeometryKm({ lat: y, lon: x }, path) === 0).toBe(onEdge);
      }),
    );
  });
});
