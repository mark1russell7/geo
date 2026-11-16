import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import {
  circleKm,
  circleMeters,
  DEFAULT_CIRCLE_VERTICES,
  destinationKm,
  distanceKm,
  EARTH_MEAN_RADIUS_KM,
  followsRightHandRule,
  GeoError,
  locatePoint,
  MAX_CIRCLE_VERTICES,
  parseGeometry,
  ringWinding,
  type LatLon,
  type MultiPolygon,
  type Polygon,
  type Position,
} from "./index.ts";

/** Half of the circumference of the sphere, in kilometres. */
const HALF = Math.PI * EARTH_MEAN_RADIUS_KM;

const at = (lat: number, lon: number): LatLon => ({ lat, lon });

/** This function gives each position of each ring of a result. */
function positionsOf(shape: Polygon | MultiPolygon): Position[] {
  const polygons = shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
  return polygons.flatMap((rings) => rings.flatMap((ring) => [...ring]));
}

/** This function gives the error code of a function that throws a `GeoError`. */
function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof GeoError) return error.code;
    throw error;
  }
  throw new Error("no error");
}

describe("circleKm", () => {
  it("gives a ring of the default vertices, counterclockwise from the north of the center", () => {
    const circle = circleKm(at(0, 0), 111.195);
    expect(circle.type).toBe("Polygon");
    const ring = (circle as Polygon).coordinates[0]!;
    expect(ring).toHaveLength(DEFAULT_CIRCLE_VERTICES + 1);
    expect(ring[0]![0]).toBeCloseTo(0, 12);
    expect(ring[0]![1]).toBeCloseTo(1, 4);
    // The second vertex is to the west of the first, so the ring goes counterclockwise.
    expect(ring[1]![0]).toBeLessThan(0);
    expect(ring[ring.length - 1]).toEqual(ring[0]);
    expect(ringWinding(ring)).toBe("counterclockwise");
    expect(locatePoint(at(0, 0), circle)).toBe("inside");
    expect(locatePoint(at(0, 1.5), circle)).toBe("outside");
  });

  it("cuts a circle across the antimeridian into two parts", () => {
    const circle = circleKm(at(-17.5, 179.8), 100);
    expect(circle.type).toBe("MultiPolygon");
    const [west, east] = (circle as MultiPolygon).coordinates;
    const westLons = west![0]!.map((p) => p[0]);
    const eastLons = east![0]!.map((p) => p[0]);
    expect(Math.max(...westLons)).toBe(180);
    expect(Math.min(...westLons)).toBeGreaterThan(178);
    expect(Math.min(...eastLons)).toBe(-180);
    expect(Math.max(...eastLons)).toBeLessThan(-178);
    expect(followsRightHandRule(circle)).toBe(true);
    expect(locatePoint(at(-17.5, 179.9), circle)).toBe("inside");
    expect(locatePoint(at(-17.5, -179.9), circle)).toBe("inside");
    expect(locatePoint(at(-17.5, 180), circle)).toBe("boundary");
    expect(locatePoint(at(-17.5, -178.5), circle)).toBe("outside");
  });

  it("cuts a circle with its center to the east of -180", () => {
    const circle = circleKm(at(10, -179.9), 50);
    expect(circle.type).toBe("MultiPolygon");
    expect(followsRightHandRule(circle)).toBe(true);
    expect(locatePoint(at(10, 179.9), circle)).toBe("inside");
    expect(locatePoint(at(10, -179.95), circle)).toBe("inside");
  });

  it("gives a circle around the north pole as one ring from -180 to 180", () => {
    const circle = circleKm(at(85, 30), 1000);
    expect(circle.type).toBe("Polygon");
    const lons = positionsOf(circle).map((p) => p[0]);
    expect(Math.min(...lons)).toBe(-180);
    expect(Math.max(...lons)).toBe(180);
    expect(followsRightHandRule(circle)).toBe(true);
    expect(locatePoint(at(90, 0), circle)).toBe("boundary");
    expect(locatePoint(at(89, 123), circle)).toBe("inside");
    expect(locatePoint(at(85, 30), circle)).toBe("inside");
    expect(locatePoint(at(75, -150), circle)).toBe("outside");
  });

  it("gives a circle around the south pole as one ring from -180 to 180", () => {
    const circle = circleKm(at(-88, -120), 500);
    expect(circle.type).toBe("Polygon");
    expect(followsRightHandRule(circle)).toBe(true);
    expect(locatePoint(at(-90, 0), circle)).toBe("boundary");
    expect(locatePoint(at(-89.5, 60), circle)).toBe("inside");
    expect(locatePoint(at(-80, 60), circle)).toBe("outside");
  });

  it("gives a circle at a pole as a circle of latitude", () => {
    const circle = circleKm(at(90, 0), 1000);
    const lats = positionsOf(circle)
      .filter((p) => Math.abs(p[0]) < 180 && p[1] < 90)
      .map((p) => p[1]);
    for (const lat of lats) expect(lat).toBeCloseTo(90 - (1000 / HALF) * 180, 9);
    expect(locatePoint(at(85, -100), circle)).toBe("inside");
    expect(locatePoint(at(80, -100), circle)).toBe("outside");
  });

  it("gives a circle around the two poles as the Earth less the opposite circle", () => {
    const circle = circleKm(at(0, 0), 15000);
    expect(circle.type).toBe("Polygon");
    expect((circle as Polygon).coordinates).toHaveLength(1);
    expect(followsRightHandRule(circle)).toBe(true);
    expect(locatePoint(at(0, 0), circle)).toBe("inside");
    expect(locatePoint(at(89, 0), circle)).toBe("inside");
    expect(locatePoint(at(0, 120), circle)).toBe("inside");
    expect(locatePoint(at(0, 140), circle)).toBe("outside");
    expect(locatePoint(at(0, 179), circle)).toBe("outside");
    expect(locatePoint(at(0, -170), circle)).toBe("outside");
    expect(locatePoint(at(90, 0), circle)).toBe("boundary");
    expect(locatePoint(at(-90, 0), circle)).toBe("boundary");
  });

  it("gives a hole for an opposite circle that does not cross the antimeridian", () => {
    const circle = circleKm(at(0, 180), 15000);
    expect(circle.type).toBe("Polygon");
    const rings = (circle as Polygon).coordinates;
    expect(rings).toHaveLength(2);
    expect(ringWinding(rings[1]!)).toBe("clockwise");
    expect(followsRightHandRule(circle)).toBe(true);
    expect(locatePoint(at(0, 0), circle)).toBe("outside");
    expect(locatePoint(at(0, 179), circle)).toBe("inside");
  });

  it("gives the whole Earth for a radius of half the circumference or more", () => {
    const world = [
      [-180, -90],
      [180, -90],
      [180, 90],
      [-180, 90],
      [-180, -90],
    ];
    expect(circleKm(at(12, 34), HALF)).toEqual({ type: "Polygon", coordinates: [world] });
    expect(circleKm(at(12, 34), 1e6)).toEqual({ type: "Polygon", coordinates: [world] });
  });

  it("gives a correct ring for a circle through the two poles", () => {
    for (const vertices of [4, 5, 64]) {
      const circle = circleKm(at(0, 0), HALF / 2, { vertices });
      expect(followsRightHandRule(circle)).toBe(true);
      expect(locatePoint(at(45, 45), circle)).toBe("inside");
      expect(locatePoint(at(-45, -45), circle)).toBe("inside");
      expect(locatePoint(at(0, 100), circle)).toBe("outside");
    }
  });

  it("makes a vertex at a pole an edge along the pole", () => {
    // The angle from the latitude 45 to the pole is a quarter of pi, so the vertex to the north is at the pole.
    const circle = circleKm(at(45, 10), HALF / 4, { vertices: 8 });
    expect(followsRightHandRule(circle)).toBe(true);
    expect(locatePoint(at(80, 10), circle)).toBe("inside");
    expect(locatePoint(at(80, -170), circle)).toBe("outside");
    expect(positionsOf(circle).some((p) => p[1] === 90 || p[1] > 89.999999)).toBe(true);
  });

  it("keeps a ring for a circle that is too small for the numbers", () => {
    const circle = circleKm(at(90, 0), 1e-13);
    const ring = (circle as Polygon).coordinates[0]!;
    expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(ring[ring.length - 1]).toEqual(ring[0]);
  });

  it("uses the number of the vertices and the radius of the sphere", () => {
    const circle = circleKm(at(0, 0), 10, { vertices: 3 });
    expect((circle as Polygon).coordinates[0]).toHaveLength(4);
    const big = circleKm(at(0, 0), 10, {}, EARTH_MEAN_RADIUS_KM / 2);
    expect((big as Polygon).coordinates[0]![0]![1]).toBeCloseTo(2 * (circle as Polygon).coordinates[0]![0]![1], 9);
  });

  it("refuses an incorrect input with a GeoError", () => {
    expect(codeOf(() => circleKm(at(0, 0), 0))).toBe("radius");
    expect(codeOf(() => circleKm(at(0, 0), -1))).toBe("radius");
    expect(codeOf(() => circleKm(at(0, 0), Number.NaN))).toBe("not-finite");
    expect(codeOf(() => circleKm(at(91, 0), 1))).toBe("latitude-range");
    expect(codeOf(() => circleKm(at(0, 0), 1, {}, 0))).toBe("radius");
    for (const vertices of [2, 2.5, MAX_CIRCLE_VERTICES + 1, Number.NaN]) {
      expect(codeOf(() => circleKm(at(0, 0), 1, { vertices }))).toBe("vertices");
    }
    expect(codeOf(() => circleMeters(at(0, 0), 1, { vertices: 1 }))).toBe("vertices");
  });
});

describe("circleMeters", () => {
  it("gives the circle of the same radius in kilometres", () => {
    const meters = positionsOf(circleMeters(at(40, -100), 25_000));
    const km = positionsOf(circleKm(at(40, -100), 25));
    expect(meters).toHaveLength(km.length);
    meters.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(km[i]![0], 9);
      expect(p[1]).toBeCloseTo(km[i]![1], 9);
    });
  });
});

describe("the properties of a circle", () => {
  const lat = uniformDouble({ min: -90, max: 90 });
  const lon = uniformDouble({ min: -180, max: 180 });
  const center: fc.Arbitrary<LatLon> = fc.record({ lat, lon });
  const radius = uniformDouble({ min: 0.001, max: HALF * 1.01 });

  it("is valid GeoJSON with each longitude from -180 to 180", () => {
    fc.assert(
      fc.property(center, radius, fc.integer({ min: 3, max: 200 }), (c, r, vertices) => {
        const circle = circleKm(c, r, { vertices });
        expect(parseGeometry(circle).tag).toBe("ok");
        for (const [x, y] of positionsOf(circle)) {
          expect(Math.abs(x)).toBeLessThanOrEqual(180);
          expect(Math.abs(y)).toBeLessThanOrEqual(90);
        }
      }),
    );
  });

  it("follows the right-hand rule, has its vertices on the circle, and contains its center", () => {
    fc.assert(
      fc.property(center, uniformDouble({ min: 0.01, max: HALF - 1 }), fc.integer({ min: 16, max: 200 }), (c, r, vertices) => {
        const circle = circleKm(c, r, { vertices });
        expect(followsRightHandRule(circle)).toBe(true);
        for (const [x, y] of positionsOf(circle)) {
          if (Math.abs(x) === 180 || Math.abs(y) === 90) continue;
          expect(Math.abs(distanceKm(c, at(y, x)) - r)).toBeLessThan(1e-4);
        }
        expect(locatePoint(c, circle)).not.toBe("outside");
        expect(locatePoint(at(-c.lat, c.lon + 180), circle)).not.toBe("inside");
      }),
    );
  });

  it("contains a pole when the pole is in the circle, and not when it is far out", () => {
    fc.assert(
      fc.property(center, uniformDouble({ min: 1, max: HALF - 1 }), (c, r) => {
        const circle = circleKm(c, r);
        for (const pole of [at(90, 0), at(-90, 0)]) {
          const d = distanceKm(c, pole);
          if (d < r - 1e-6) expect(locatePoint(pole, circle)).not.toBe("outside");
          if (d > r + 1e-6) expect(locatePoint(pole, circle)).toBe("outside");
        }
      }),
    );
  });

  it("contains the points near the center and not the points far out, away from the poles", () => {
    fc.assert(
      fc.property(
        center,
        uniformDouble({ min: 1, max: 3000 }),
        uniformDouble({ min: 0, max: 360 }),
        (c, r, bearing) => {
          const degrees = (r / HALF) * 180;
          fc.pre(Math.abs(c.lat) + 1.5 * degrees < 85);
          const circle = circleKm(c, r);
          expect(locatePoint(destinationKm(c, bearing, r / 3), circle)).toBe("inside");
          expect(locatePoint(destinationKm(c, bearing, r * 1.5), circle)).toBe("outside");
        },
      ),
    );
  });
});
