import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import {
  EARTH_MEAN_RADIUS_KM,
  GeoError,
  centralAngleRadians,
  destinationKm,
  distanceKm,
  fromUnitVector,
  intermediatePoint,
  toUnitVector,
  type GeoErrorCode,
  type LatLon,
  type UnitVector,
} from "./index.ts";

const codeOf = (run: () => unknown): GeoErrorCode | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return error.code;
    throw error;
  }
  return undefined;
};

const lat = uniformDouble({ min: -90, max: 90 });
const lon = uniformDouble({ min: -180, max: 180 });
const point: fc.Arbitrary<LatLon> = fc.record({ lat, lon });
const bearing = uniformDouble({ min: 0, max: 360 }).filter((value) => value < 360);
/** A distance that keeps the end away from the opposite point of the start, where each great circle is correct. */
const distance = uniformDouble({ min: 0, max: 19_000 });
const part = uniformDouble({ min: 0, max: 1 });

/** A limit of one millimetre, in kilometres. */
const MILLIMETRE = 1e-6;

const lengthOf = (vector: UnitVector): number => Math.hypot(vector.x, vector.y, vector.z);
const times = (vector: UnitVector, factor: number): UnitVector => ({
  x: vector.x * factor,
  y: vector.y * factor,
  z: vector.z * factor,
});

describe("the unit vector of a point", () => {
  it("has the axes of ECEF", () => {
    expect(toUnitVector({ lat: 0, lon: 0 })).toEqual({ x: 1, y: 0, z: 0 });
    const east = toUnitVector({ lat: 0, lon: 90 });
    expect(east.x).toBeCloseTo(0, 15);
    expect(east.y).toBe(1);
    expect(east.z).toBe(0);
    const north = toUnitVector({ lat: 45, lon: 0 });
    expect(north.x).toBeCloseTo(Math.SQRT1_2, 15);
    expect(north.y).toBe(0);
    expect(north.z).toBeCloseTo(Math.SQRT1_2, 15);
  });

  it("is one vector for all the longitudes of a pole", () => {
    for (const longitude of [0, 37.5, -120, 180, 720]) {
      expect(toUnitVector({ lat: 90, lon: longitude })).toEqual({ x: 0, y: 0, z: 1 });
      expect(toUnitVector({ lat: -90, lon: longitude })).toEqual({ x: 0, y: 0, z: -1 });
    }
  });

  it("has the length 1", () => {
    fc.assert(fc.property(point, (a) => Math.abs(lengthOf(toUnitVector(a)) - 1) <= 1e-15));
  });

  it("has a dot product with a second vector that is the cosine of the central angle", () => {
    fc.assert(
      fc.property(point, point, (a, b) => {
        const u = toUnitVector(a);
        const v = toUnitVector(b);
        const dot = u.x * v.x + u.y * v.y + u.z * v.z;
        return Math.abs(dot - Math.cos(centralAngleRadians(a, b))) <= 1e-12;
      }),
    );
  });

  it("does not change when the longitude moves by 360", () => {
    fc.assert(
      fc.property(point, (a) => {
        const u = toUnitVector(a);
        const v = toUnitVector({ lat: a.lat, lon: a.lon + 360 });
        return Math.hypot(u.x - v.x, u.y - v.y, u.z - v.z) <= 1e-12;
      }),
    );
  });

  it("refuses an incorrect point", () => {
    expect(codeOf(() => toUnitVector({ lat: 91, lon: 0 }))).toBe("latitude-range");
    expect(codeOf(() => toUnitVector({ lat: Number.NaN, lon: 0 }))).toBe("not-finite");
    expect(codeOf(() => toUnitVector({ lat: 0, lon: Number.POSITIVE_INFINITY }))).toBe("not-finite");
  });
});

describe("the point of a vector", () => {
  it("is the point of the unit vector", () => {
    fc.assert(fc.property(point, (a) => distanceKm(fromUnitVector(toUnitVector(a)), a) <= MILLIMETRE));
  });

  it("gives the poles and a longitude of 0 for a vector along the axis of the poles", () => {
    expect(fromUnitVector({ x: 0, y: 0, z: 2 })).toEqual({ lat: 90, lon: 0 });
    expect(fromUnitVector({ x: 0, y: 0, z: -0.5 })).toEqual({ lat: -90, lon: 0 });
    expect(fromUnitVector(toUnitVector({ lat: 90, lon: 123 }))).toEqual({ lat: 90, lon: 0 });
  });

  it("gives the points of the axes", () => {
    const zero = fromUnitVector({ x: 3, y: 0, z: 0 });
    expect(zero.lat).toBe(0);
    expect(zero.lon).toBe(0);
    const east = fromUnitVector({ x: 0, y: 3, z: 0 });
    expect(east.lat).toBe(0);
    expect(east.lon).toBeCloseTo(90, 12);
    const west = fromUnitVector({ x: 0, y: -3, z: 0 });
    expect(west.lon).toBeCloseTo(-90, 12);
    const middle = fromUnitVector({ x: 1, y: 1, z: Math.SQRT2 });
    expect(middle.lat).toBeCloseTo(45, 12);
    expect(middle.lon).toBeCloseTo(45, 12);
  });

  it("gives a normalized longitude", () => {
    fc.assert(
      fc.property(point, (a) => {
        const result = fromUnitVector(toUnitVector(a));
        return result.lon >= -180 && result.lon < 180 && result.lat >= -90 && result.lat <= 90;
      }),
    );
    expect(fromUnitVector({ x: -1, y: 0, z: 0 })).toEqual({ lat: 0, lon: -180 });
  });

  it("does not use the length of the vector", () => {
    const factor = fc.constantFrom(1e-300, 1e-150, 0.5, 3, 1e150, 1e300);
    fc.assert(
      fc.property(point, factor, (a, k) => distanceKm(fromUnitVector(times(toUnitVector(a), k)), a) <= MILLIMETRE),
    );
    const largest = fromUnitVector({ x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: 0 });
    expect(largest.lat).toBe(0);
    expect(largest.lon).toBeCloseTo(45, 12);
    const smallest = fromUnitVector({ x: 0, y: Number.MIN_VALUE, z: Number.MIN_VALUE });
    expect(smallest.lat).toBeCloseTo(45, 12);
    expect(smallest.lon).toBeCloseTo(90, 12);
  });

  it("refuses a vector with no direction", () => {
    expect(codeOf(() => fromUnitVector({ x: 0, y: 0, z: 0 }))).toBe("vector");
    expect(codeOf(() => fromUnitVector({ x: -0, y: 0, z: -0 }))).toBe("vector");
    expect(codeOf(() => fromUnitVector({ x: Number.NaN, y: 0, z: 1 }))).toBe("not-finite");
    expect(codeOf(() => fromUnitVector({ x: 1, y: Number.POSITIVE_INFINITY, z: 1 }))).toBe("not-finite");
    expect(codeOf(() => fromUnitVector({ x: 1, y: 0, z: Number.NEGATIVE_INFINITY }))).toBe("not-finite");
  });
});

describe("the intermediate point", () => {
  it("is the start at 0 and the end at 1", () => {
    fc.assert(
      fc.property(point, bearing, distance, (from, theta, d) => {
        const to = destinationKm(from, theta, d);
        return (
          distanceKm(intermediatePoint(from, to, 0), from) <= MILLIMETRE &&
          distanceKm(intermediatePoint(from, to, 1), to) <= MILLIMETRE
        );
      }),
    );
  });

  it("divides the distance by the part", () => {
    fc.assert(
      fc.property(point, bearing, distance, part, (from, theta, d, t) => {
        const to = destinationKm(from, theta, d);
        const all = distanceKm(from, to);
        const middle = intermediatePoint(from, to, t);
        return (
          Math.abs(distanceKm(from, middle) - t * all) <= MILLIMETRE &&
          Math.abs(distanceKm(middle, to) - (1 - t) * all) <= MILLIMETRE
        );
      }),
    );
  });

  it("is the same point from the two ends", () => {
    fc.assert(
      fc.property(point, bearing, distance, part, (from, theta, d, t) => {
        const to = destinationKm(from, theta, d);
        return distanceKm(intermediatePoint(from, to, t), intermediatePoint(to, from, 1 - t)) <= MILLIMETRE;
      }),
    );
  });

  it("is the point when the start and the end are equal", () => {
    fc.assert(fc.property(point, part, (a, t) => distanceKm(intermediatePoint(a, a, t), a) <= MILLIMETRE));
  });

  it("gives known points on the equator and on a meridian", () => {
    const equator = intermediatePoint({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, 0.5);
    expect(equator.lat).toBeCloseTo(0, 12);
    expect(equator.lon).toBeCloseTo(45, 12);
    const meridian = intermediatePoint({ lat: 10, lon: 20 }, { lat: 50, lon: 20 }, 0.25);
    expect(meridian.lat).toBeCloseTo(20, 12);
    expect(meridian.lon).toBeCloseTo(20, 12);
    const toPole = intermediatePoint({ lat: 0, lon: -75 }, { lat: 90, lon: 0 }, 0.5);
    expect(toPole.lat).toBeCloseTo(45, 12);
    expect(toPole.lon).toBeCloseTo(-75, 12);
    const fromPole = intermediatePoint({ lat: 90, lon: 0 }, { lat: 0, lon: -75 }, 0.5);
    expect(fromPole.lat).toBeCloseTo(45, 12);
    expect(fromPole.lon).toBeCloseTo(-75, 12);
  });

  it("goes across the antimeridian on the short way", () => {
    const middle = intermediatePoint({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 0.5);
    expect(distanceKm(middle, { lat: 0, lon: 180 })).toBeLessThanOrEqual(MILLIMETRE);
  });

  it("continues on the great circle before the start and after the end", () => {
    const start = { lat: 0, lon: 0 };
    const end = { lat: 0, lon: 60 };
    expect(distanceKm(intermediatePoint(start, end, 2), { lat: 0, lon: 120 })).toBeLessThanOrEqual(MILLIMETRE);
    expect(distanceKm(intermediatePoint(start, end, -1), { lat: 0, lon: -60 })).toBeLessThanOrEqual(MILLIMETRE);
    expect(distanceKm(intermediatePoint(start, end, 3), { lat: 0, lon: 180 })).toBeLessThanOrEqual(MILLIMETRE);
  });

  it("is a quarter of a circle from each of two opposite points at 0.5", () => {
    const quarter = (Math.PI / 2) * EARTH_MEAN_RADIUS_KM;
    const pairs: readonly (readonly [LatLon, LatLon])[] = [
      [
        { lat: 0, lon: 0 },
        { lat: 0, lon: 180 },
      ],
      [
        { lat: 10, lon: 20 },
        { lat: -10, lon: -160 },
      ],
      [
        { lat: 90, lon: 0 },
        { lat: -90, lon: 0 },
      ],
    ];
    for (const [from, to] of pairs) {
      const middle = intermediatePoint(from, to, 0.5);
      expect(Math.abs(distanceKm(from, middle) - quarter)).toBeLessThanOrEqual(MILLIMETRE);
      expect(Math.abs(distanceKm(middle, to) - quarter)).toBeLessThanOrEqual(MILLIMETRE);
    }
  });

  it("refuses an incorrect input", () => {
    const a = { lat: 0, lon: 0 };
    const b = { lat: 10, lon: 10 };
    expect(codeOf(() => intermediatePoint(a, b, Number.NaN))).toBe("not-finite");
    expect(codeOf(() => intermediatePoint(a, b, Number.POSITIVE_INFINITY))).toBe("not-finite");
    expect(codeOf(() => intermediatePoint({ lat: 91, lon: 0 }, b, 0.5))).toBe("latitude-range");
    expect(codeOf(() => intermediatePoint(a, { lat: Number.NaN, lon: 0 }, 0.5))).toBe("not-finite");
  });
});
