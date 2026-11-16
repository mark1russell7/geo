import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import {
  EARTH_MEAN_RADIUS_KM,
  GeoError,
  distanceBetweenGeometriesKm,
  distanceBetweenGeometriesMeters,
  distanceKm,
  distanceToGeometryKm,
  distanceToGeometryMeters,
  locatePoint,
  polygonsIntersect,
  type Geometry,
  type LatLon,
  type LineString,
  type Polygon,
  type Position,
} from "./index.ts";
import { angleBoundToEdge, angleToEdge, viewerAt } from "./distance.ts";

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

describe("the bound of the angle to an edge", () => {
  it("is not less than the angle, and is the same for the two directions of the edge", () => {
    fc.assert(
      fc.property(
        edge.chain((ab) => fc.tuple(fc.constant(ab), viewerFor(ab))),
        ([[a, b], from]) => {
          const viewer = viewerAt([from.lon, from.lat]);
          const bound = angleBoundToEdge(viewer, a, b);
          expect(bound).toBeGreaterThanOrEqual(angleToEdge(viewer, a, b));
          expect(angleBoundToEdge(viewer, b, a)).toBe(bound);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("is the angle to the end for a viewer past the end of the edge", () => {
    const viewer = viewerAt([3, 0]);
    expect(angleBoundToEdge(viewer, [0, 0], [1, 0])).toBeCloseTo(angleToEdge(viewer, [0, 0], [1, 0]), 12);
  });

  // The counterexample of the CI run 43951591517 (seed -1427318154). The viewer is at the south pole, and the near end
  // of the edge is 3.6e-13 degrees from it. The probe point is that end, but the probe gets its latitude difference from
  // the far end as 3.4e-13 degrees. So the probe value was 8 % less than the value of the end. The box bound of the
  // search was equal to the value of the end, so the search gave the value of the end with no probe. The old bound was
  // the latitude gap bound, with no term of the longitude, and the angle was 1 rounding step more than the bound.
  it("is not less than the angle for an edge from pole to pole and a viewer at a pole", () => {
    const a: Position = [179.9999999999996, -89.99999999999964];
    const b: Position = [126.59037307505119, 89.99999999999903];
    const viewer = viewerAt([180.00077279447837, -90]);
    expect(angleBoundToEdge(viewer, a, b)).toBeGreaterThanOrEqual(angleToEdge(viewer, a, b));
    expect(angleBoundToEdge(viewer, b, a)).toBeGreaterThanOrEqual(angleToEdge(viewer, b, a));
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

describe("the distance between two geometries", () => {
  const RAD = Math.PI / 180;
  const point = (lon: number, lat: number): Geometry => ({ type: "Point", coordinates: [lon, lat] });

  it("is 0 for lines that cross, and for a line that crosses an edge of a polygon", () => {
    expect(distanceBetweenGeometriesKm(line([0, 0], [10, 10]), line([0, 10], [10, 0]))).toBe(0);
    expect(distanceBetweenGeometriesKm(line([-5, 0], [5, 0]), square(0, -5, 10, 5))).toBe(0);
    expect(distanceBetweenGeometriesKm(square(0, -5, 10, 5), line([-5, 0], [5, 0]))).toBe(0);
  });

  it("is 0 for a polygon in a polygon and for a line in a polygon, in the two orders", () => {
    const outer = square(0, -10, 30, 10);
    const inner = square(12, -3, 18, 3);
    expect(distanceBetweenGeometriesKm(outer, inner)).toBe(0);
    expect(distanceBetweenGeometriesKm(inner, outer)).toBe(0);
    expect(distanceBetweenGeometriesKm(line([2, 0], [3, 1]), outer)).toBe(0);
    expect(distanceBetweenGeometriesKm(outer, line([2, 0], [3, 1]))).toBe(0);
  });

  it("is more than 0 for a polygon in a hole, and is the distance to the edge of the hole", () => {
    const withHole: Polygon = { type: "Polygon", coordinates: [...square(0, -10, 30, 10).coordinates, ...square(10, -5, 20, 5).coordinates] };
    const inner = square(12, -3, 18, 3);
    // The nearest point of the meridian 20 to the corner (18, 3) is on the edge of the hole: sin d = sin 2° cos 3°.
    const expected = km(Math.asin(Math.sin(2 * RAD) * Math.cos(3 * RAD)) / RAD);
    expect(polygonsIntersect(withHole, inner)).toBe(false);
    expect(distanceBetweenGeometriesKm(withHole, inner)).toBeCloseTo(expected, 6);
    expect(distanceBetweenGeometriesKm(inner, withHole)).toBe(distanceBetweenGeometriesKm(withHole, inner));
    expect(distanceBetweenGeometriesKm(withHole, square(10, -5, 20, 5))).toBe(0);
  });

  it("is 0 for polygons that touch at one vertex, and more than 0 for polygons very near", () => {
    expect(distanceBetweenGeometriesKm(square(0, 0, 1, 1), square(1, 1, 2, 2))).toBe(0);
    expect(distanceBetweenGeometriesKm(square(0, 0, 1, 1), point(1, 1))).toBe(0);
    const near = square(1 + 2 ** -40, 1, 2, 2);
    const d = distanceBetweenGeometriesKm(square(0, 0, 1, 1), near);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1e-6);
    expect(distanceBetweenGeometriesKm(square(0, 0, 1, 1), near, 1e-300)).toBeGreaterThan(0);
  });

  it("is the gap of two parallel lines, and the gap to the nearest end of two lines on the equator", () => {
    expect(distanceBetweenGeometriesKm(line([0, 0], [10, 0]), line([0, 2], [10, 2]))).toBeCloseTo(km(2), 9);
    expect(distanceBetweenGeometriesKm(line([0, 0], [10, 0]), line([13, 0], [20, 0]))).toBeCloseTo(km(3), 9);
    // The nearest point of the equator to the end (5, 4) of the second line is (5, 0).
    expect(distanceBetweenGeometriesKm(line([0, 0], [10, 0]), line([5, 4], [5, 9]))).toBeCloseTo(km(4), 9);
  });

  it("is the distance of distanceToGeometryKm for a point, in the two orders", () => {
    const area = square(10, -5, 20, 5);
    const lines: Geometry = { type: "MultiLineString", coordinates: [[[0, 40], [30, 50]], [[-170, -80], [170, -60]]] };
    for (const [lon, lat] of [[25, 0], [0, 0], [15, 0], [20, 5], [33, 44], [-170, -80], [181, 89.5], [0, -90]] as const) {
      for (const geometry of [area, lines]) {
        const expected = distanceToGeometryKm({ lat, lon }, geometry);
        expect(distanceBetweenGeometriesKm(point(lon, lat), geometry)).toBe(expected);
        expect(distanceBetweenGeometriesKm(geometry, point(lon, lat))).toBe(expected);
      }
    }
  });

  it("works across the antimeridian", () => {
    expect(distanceBetweenGeometriesKm(line([170, 0], [178, 0]), line([-178, 0], [-170, 0]))).toBeCloseTo(km(4), 9);
    // In the plane, the second line is from (180, 5) to (185, -5), and it crosses the first line at 181 2/3.
    expect(distanceBetweenGeometriesKm(line([175, -5], [185, 5]), line([-180, 5], [-175, -5]))).toBe(0);
    expect(distanceBetweenGeometriesKm(square(170, -5, 190, 5), square(-178, -1, -172, 1))).toBe(0);
    expect(distanceBetweenGeometriesKm(square(-178, -1, -172, 1), square(170, -5, 190, 5))).toBe(0);
    // The meridians 175 and 185 come nearer to the poles, so the nearest points are the corners at 5 and -5.
    const corners = distanceKm({ lat: 5, lon: 175 }, { lat: 5, lon: -175 });
    expect(distanceBetweenGeometriesKm(square(170, -5, 175, 5), square(-175, -5, -170, 5))).toBeCloseTo(corners, 9);
  });

  it("is 0 for two lines that touch a pole at different longitudes", () => {
    expect(distanceBetweenGeometriesKm(line([0, 80], [0, 90]), line([90, 85], [90, 90]))).toBe(0);
    expect(distanceBetweenGeometriesKm(line([0, -80], [0, -90]), line([90, -85], [90, -90]))).toBe(0);
    // The two lines are on one meridian, so the nearest points are the ends at 80 and at -85.
    expect(distanceBetweenGeometriesKm(line([0, 80], [0, 90]), line([0, -85], [0, -90]))).toBeCloseTo(km(165), 9);
  });

  it("is the gap from a cap around a pole to a line, and 0 for a pole in the cap", () => {
    const cap = square(-180, 80, 180, 90);
    expect(distanceBetweenGeometriesKm(cap, line([0, 70], [10, 70]))).toBeCloseTo(km(10), 9);
    expect(distanceBetweenGeometriesKm(line([0, 70], [10, 70]), cap)).toBeCloseTo(km(10), 9);
    expect(distanceBetweenGeometriesKm(cap, point(45, 90))).toBe(0);
    expect(distanceBetweenGeometriesKm(cap, line([33, 85], [34, 86]))).toBe(0);
  });

  it("is the smallest distance between the members of collections", () => {
    const a: Geometry = { type: "GeometryCollection", geometries: [point(40, 0), line([0, 20], [10, 20])] };
    const b: Geometry = { type: "MultiPolygon", coordinates: [square(10, -5, 20, 5).coordinates, square(45, -1, 50, 1).coordinates] };
    expect(distanceBetweenGeometriesKm(a, b)).toBeCloseTo(km(5), 9);
    expect(distanceBetweenGeometriesKm(b, a)).toBe(distanceBetweenGeometriesKm(a, b));
  });

  it("is Infinity when a geometry has no position, in the two orders", () => {
    const empty: Geometry = { type: "GeometryCollection", geometries: [] };
    expect(distanceBetweenGeometriesKm(empty, square(0, 0, 1, 1))).toBe(Number.POSITIVE_INFINITY);
    expect(distanceBetweenGeometriesKm(square(0, 0, 1, 1), { type: "MultiPoint", coordinates: [] })).toBe(Number.POSITIVE_INFINITY);
    expect(distanceBetweenGeometriesKm(line(), empty)).toBe(Number.POSITIVE_INFINITY);
    expect(distanceBetweenGeometriesMeters({ type: "Polygon", coordinates: [] }, point(0, 0))).toBe(Number.POSITIVE_INFINITY);
  });

  it("gives metres as kilometres times 1000, and scales with the radius", () => {
    const a = line([0, 0], [10, 0]);
    const b = square(12, 3, 20, 9);
    const inKm = distanceBetweenGeometriesKm(a, b);
    expect(inKm).toBeGreaterThan(0);
    expect(distanceBetweenGeometriesMeters(a, b)).toBeCloseTo(inKm * 1000, 6);
    expect(distanceBetweenGeometriesKm(a, b, 1)).toBeCloseTo(inKm / EARTH_MEAN_RADIUS_KM, 12);
  });

  it("refuses a radius that is not more than 0", () => {
    expect(codeOf(() => distanceBetweenGeometriesKm(point(0, 0), point(1, 1), 0)).code).toBe("radius");
    expect(codeOf(() => distanceBetweenGeometriesMeters(point(0, 0), point(1, 1), Number.NaN)).code).toBe("not-finite");
  });

  it("refuses an incorrect geometry with a path that starts with a or b", () => {
    const open = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } as Polygon;
    expect(codeOf(() => distanceBetweenGeometriesKm(line([0, 0], [1, 1]), open))).toEqual({ code: "ring-not-closed", path: "b.coordinates[0]" });
    expect(codeOf(() => distanceBetweenGeometriesKm(line([0, 0], [1e12, 0]), open))).toEqual({ code: "longitude-range", path: "a.coordinates[1]" });
    const nested: Geometry = { type: "GeometryCollection", geometries: [point(0, 0), line([0, 0], [600, 0])] };
    expect(codeOf(() => distanceBetweenGeometriesKm(point(0, 0), nested))).toEqual({
      code: "longitude-range",
      path: "b.geometries[1].coordinates[1]",
    });
    expect(codeOf(() => distanceBetweenGeometriesKm({ type: "Circle" } as unknown as Geometry, point(0, 0)))).toEqual({
      code: "geojson-type",
      path: "a",
    });
  });
});

// The reference of two edges: the smallest distance over a grid of pairs of points of the two edges, refined near the
// best pair. It uses distanceKm, so it does not share the formula of the function under test.
const PAIR_SAMPLES = 200;

function golden(at: (t: number) => number, from: number, to: number): number {
  let low = from;
  let high = to;
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let round = 0; round < 60; round += 1) {
    const p = high - ratio * (high - low);
    const q = low + ratio * (high - low);
    if (at(p) < at(q)) high = q;
    else low = p;
  }
  return at(low) < at(high) ? low : high;
}

function pairReference(
  [a, b]: readonly [Position, Position],
  [c, d]: readonly [Position, Position],
): { sampled: number; refined: number; steps: number } {
  const at = (u: number, v: number): number => distanceKm(pointAt(a, b, u), pointAt(c, d, v));
  let sampled = Number.POSITIVE_INFINITY;
  let u = 0;
  let v = 0;
  for (let i = 0; i <= PAIR_SAMPLES; i += 1) {
    for (let j = 0; j <= PAIR_SAMPLES; j += 1) {
      const value = at(i / PAIR_SAMPLES, j / PAIR_SAMPLES);
      if (value < sampled) {
        sampled = value;
        u = i / PAIR_SAMPLES;
        v = j / PAIR_SAMPLES;
      }
    }
  }
  // A descent on one coordinate at a time, in a window of one step around the best pair.
  const window = 1 / PAIR_SAMPLES;
  let refined = sampled;
  for (let round = 0; round < 20; round += 1) {
    u = golden((t) => at(t, v), Math.max(0, u - window), Math.min(1, u + window));
    v = golden((t) => at(u, t), Math.max(0, v - window), Math.min(1, v + window));
    refined = Math.min(refined, at(u, v));
  }
  // The arc between two points of an edge at a distance of 1 / PAIR_SAMPLES is not more than one step.
  const step = (p: Position, q: Position): number => km(Math.hypot(q[0] - p[0], q[1] - p[1]) / PAIR_SAMPLES);
  return { sampled, refined, steps: step(a, b) + step(c, d) };
}

/** An edge near a point of the edge `ab`, nearly parallel to it, so that the nearest points can be inside both edges. */
const nearEdge = ([a, b]: readonly [Position, Position]): fc.Arbitrary<readonly [Position, Position]> =>
  fc
    .tuple(
      uniformDouble({ min: 0, max: 1 }),
      uniformDouble({ min: -1, max: 1 }),
      uniformDouble({ min: -1, max: 1 }),
      uniformDouble({ min: -0.3, max: 0.3 }),
      uniformDouble({ min: 0.1, max: 1 }),
    )
    .map(([u, dy, dx, turn, scale]): readonly [Position, Position] => {
      const on = pointAt(a, b, u);
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const hx = ((ex * Math.cos(turn) - ey * Math.sin(turn)) * scale) / 2;
      const hy = ((ex * Math.sin(turn) + ey * Math.cos(turn)) * scale) / 2;
      const clamp = (y: number): number => Math.max(-90, Math.min(90, y));
      const x = on.lon + dx;
      const y = clamp(on.lat + dy);
      return [[x - hx, clamp(y - hy)], [x + hx, clamp(y + hy)]];
    });

describe("the distance between two edges, against a dense reference", () => {
  // The test makes 150 pairs with a dense reference each. Under coverage on a busy runner, it takes more than 5 s.
  it("is not more than the reference, and not less than the sample by more than half the steps", () => {
    fc.assert(
      fc.property(
        edge.chain((ab) => fc.tuple(fc.constant(ab), fc.oneof(edge, nearEdge(ab)))),
        ([ab, cd]) => {
          const d = distanceBetweenGeometriesKm(line(...ab), line(...cd));
          const { sampled, refined, steps } = pairReference(ab, cd);
          expect(d).toBeLessThanOrEqual(refined + 1e-7);
          expect(d).toBeGreaterThanOrEqual(sampled - steps / 2 - 1e-7);
        },
      ),
      { numRuns: 150 },
    );
  }, 30_000);
});
