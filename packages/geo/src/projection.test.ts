import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import { GeoError } from "./errors.ts";
import { geodesicDirect, geodesicInverse, geodesicReducedLength, WGS84, type Ellipsoid } from "./geodesic.ts";
import type { LatLon } from "./point.ts";
import { azimuthalEquidistant, WEB_MERCATOR, WEB_MERCATOR_MAX_LATITUDE, WEB_MERCATOR_MAX_METERS } from "./projection.ts";

const E2 = WGS84.flattening * (2 - WGS84.flattening);
const SPHERE: Ellipsoid = { equatorialRadiusMeters: 6_371_000, flattening: 0 };

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return error.code;
    throw error;
  }
  return undefined;
}

describe("WEB_MERCATOR", () => {
  it("gives the known points of EPSG:3857", () => {
    expect(WEB_MERCATOR.toPlane({ lat: 0, lon: 0 })).toEqual({ x: 0, y: 0 });
    const p = WEB_MERCATOR.toPlane({ lat: 50, lon: 10 });
    expect(p.x).toBeCloseTo(1_113_194.9079327357, 6);
    expect(p.y).toBeCloseTo(6_446_275.84101716, 6);
    expect(WEB_MERCATOR_MAX_METERS).toBeCloseTo(20_037_508.342789244, 6);
    expect(WEB_MERCATOR_MAX_LATITUDE).toBeCloseTo(85.0511287798066, 12);
    expect(WEB_MERCATOR.toPlane({ lat: WEB_MERCATOR_MAX_LATITUDE, lon: 0 }).y).toBeCloseTo(WEB_MERCATOR_MAX_METERS, 6);
  });

  it("normalizes the longitude, and gives no negative zero", () => {
    expect(WEB_MERCATOR.toPlane({ lat: 0, lon: 180 }).x).toBe(-WEB_MERCATOR_MAX_METERS);
    expect(WEB_MERCATOR.toPlane({ lat: 0, lon: 370 }).x).toBeCloseTo(WEB_MERCATOR.toPlane({ lat: 0, lon: 10 }).x, 6);
    const zero = WEB_MERCATOR.toPlane({ lat: -0, lon: -0 });
    expect(Object.is(zero.x, 0) && Object.is(zero.y, 0)).toBe(true);
    expect(WEB_MERCATOR.fromPlane({ x: 3 * WEB_MERCATOR_MAX_METERS, y: 0 }).lon).toBe(-180);
    expect(WEB_MERCATOR.fromPlane(WEB_MERCATOR.toPlane({ lat: 10, lon: -180 })).lon).toBe(-180);
  });

  it("gives the point back from the plane", () => {
    fc.assert(
      fc.property(uniformDouble({ min: -WEB_MERCATOR_MAX_LATITUDE, max: WEB_MERCATOR_MAX_LATITUDE }), uniformDouble({ min: -180, max: 179.999 }), (lat, lon) => {
        const back = WEB_MERCATOR.fromPlane(WEB_MERCATOR.toPlane({ lat, lon }));
        expect(back.lat).toBeCloseTo(lat, 9);
        expect(back.lon).toBeCloseTo(lon, 9);
      }),
      { numRuns: 300 },
    );
  });

  it("gives the scale of the ellipsoid along the meridian and along the parallel", () => {
    expect(WEB_MERCATOR.scale({ lat: 0, lon: 0 })).toEqual({ max: 1 / (1 - E2), min: 1 });
    // A short line along the parallel and along the meridian, measured on the plane and on the ellipsoid.
    const d = 1e-4;
    for (const lat of [-70, -30, 0, 42.5, 60, 85]) {
      const { max, min } = WEB_MERCATOR.scale({ lat, lon: 3 });
      const west = { lat, lon: 3 - d / 2 };
      const east = { lat, lon: 3 + d / 2 };
      const south = { lat: lat - d / 2, lon: 3 };
      const north = { lat: lat + d / 2, lon: 3 };
      const alongParallel = (WEB_MERCATOR.toPlane(east).x - WEB_MERCATOR.toPlane(west).x) / geodesicInverse(west, east).meters;
      const alongMeridian = (WEB_MERCATOR.toPlane(north).y - WEB_MERCATOR.toPlane(south).y) / geodesicInverse(south, north).meters;
      expect(min / alongParallel).toBeCloseTo(1, 8);
      expect(max / alongMeridian).toBeCloseTo(1, 8);
    }
    expect(WEB_MERCATOR.scale({ lat: 60, lon: 0 }).min).toBeCloseTo(2 * Math.sqrt(1 - E2 * 0.75), 12);
  });

  it("refuses a latitude out of its range and a value that is not finite", () => {
    expect(code(() => WEB_MERCATOR.toPlane({ lat: 86, lon: 0 }))).toBe("latitude-range");
    expect(code(() => WEB_MERCATOR.scale({ lat: -86, lon: 0 }))).toBe("latitude-range");
    expect(code(() => WEB_MERCATOR.toPlane({ lat: Number.NaN, lon: 0 }))).toBe("not-finite");
    expect(code(() => WEB_MERCATOR.fromPlane({ x: 0, y: Number.POSITIVE_INFINITY }))).toBe("not-finite");
    expect(code(() => WEB_MERCATOR.fromPlane({ x: Number.NaN, y: 0 }))).toBe("not-finite");
    expect(Object.isFrozen(WEB_MERCATOR)).toBe(true);
  });
});

describe("azimuthalEquidistant", () => {
  const centers: readonly LatLon[] = [
    { lat: 45, lon: 10 },
    { lat: -30, lon: 150 },
    { lat: 0, lon: -179.5 },
    { lat: 90, lon: 0 },
  ];

  it("puts the center at the origin, and gives the distance and the bearing of the geodesic", () => {
    for (const center of centers) {
      const projection = azimuthalEquidistant(center);
      expect(projection.toPlane(center)).toEqual({ x: 0, y: 0 });
      expect(projection.fromPlane({ x: 0, y: 0 })).toEqual({ lat: center.lat, lon: center.lon });
      const far = geodesicDirect(center, 123, 15_000).point;
      const p = projection.toPlane(far);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(15_000, 6);
      expect((Math.atan2(p.x, p.y) * 180) / Math.PI).toBeCloseTo(123, 9);
    }
    const north = azimuthalEquidistant({ lat: 45, lon: 10 }).toPlane(geodesicDirect({ lat: 45, lon: 10 }, 0, 1000).point);
    expect(north.x).toBe(0);
    expect(north.y).toBeCloseTo(1000, 6);
  });

  it("gives the point back from the plane", () => {
    const projections = centers.map((center) => azimuthalEquidistant(center));
    fc.assert(
      fc.property(fc.integer({ min: 0, max: centers.length - 1 }), uniformDouble({ min: -50_000, max: 50_000 }), uniformDouble({ min: -50_000, max: 50_000 }), (i, x, y) => {
        const projection = projections[i]!;
        const point = projection.fromPlane({ x, y });
        const back = projection.toPlane(point);
        expect(back.x).toBeCloseTo(x, 5);
        expect(back.y).toBeCloseTo(y, 5);
      }),
      { numRuns: 300 },
    );
  });

  it("gives the scale 1 along the geodesic and s / m12 across it", () => {
    const center = { lat: 45, lon: 10 };
    const projection = azimuthalEquidistant(center);
    expect(projection.scale(center)).toEqual({ max: 1, min: 1 });
    // Two points at the same distance from the center, with bearings that differ by a small angle.
    const d = 1e-3;
    for (const meters of [1000, 20_000, 500_000, 5_000_000]) {
      const a = geodesicDirect(center, 70 - d / 2, meters).point;
      const b = geodesicDirect(center, 70 + d / 2, meters).point;
      const onPlane = Math.hypot(projection.toPlane(a).x - projection.toPlane(b).x, projection.toPlane(a).y - projection.toPlane(b).y);
      const across = onPlane / geodesicInverse(a, b).meters;
      const { max, min } = projection.scale(geodesicDirect(center, 70, meters).point);
      expect(min).toBe(1);
      expect(max / across).toBeCloseTo(1, 7);
    }
    expect(projection.scale(geodesicDirect(center, 70, 20_000).point).max).toBeLessThan(1.000002);
  });

  it("gives the reduced length R sin(s / R) on a sphere", () => {
    const center = { lat: 10, lon: 20 };
    const R = SPHERE.equatorialRadiusMeters;
    // The error of the reduced length is approximately 1e-10 m, so the limit is in metres.
    for (const meters of [1, 1000, 1_000_000, 10_000_000]) {
      const expected = R * Math.sin(meters / R);
      expect(Math.abs(geodesicReducedLength(center, 33, meters, SPHERE) - expected)).toBeLessThan(1e-8 + 1e-12 * expected);
    }
    const projection = azimuthalEquidistant(center, SPHERE);
    const c = 1_000_000 / R;
    expect(projection.scale(geodesicDirect(center, 33, 1_000_000, SPHERE).point).max).toBeCloseTo(c / Math.sin(c), 12);
    expect(projection.scale({ lat: -10, lon: -160 }).max).toBeGreaterThan(1e6);
  });

  it("refuses an incorrect center, ellipsoid, point or point of the plane", () => {
    expect(code(() => azimuthalEquidistant({ lat: 91, lon: 0 }))).toBe("latitude-range");
    expect(code(() => azimuthalEquidistant({ lat: 0, lon: Number.NaN }))).toBe("not-finite");
    expect(code(() => azimuthalEquidistant({ lat: 0, lon: 0 }, { equatorialRadiusMeters: -1, flattening: 0 }))).toBe("radius");
    const projection = azimuthalEquidistant({ lat: 0, lon: 0 });
    expect(code(() => projection.toPlane({ lat: 100, lon: 0 }))).toBe("latitude-range");
    expect(code(() => projection.scale({ lat: Number.NaN, lon: 0 }))).toBe("not-finite");
    expect(code(() => projection.fromPlane({ x: Number.NaN, y: 0 }))).toBe("not-finite");
    expect(code(() => geodesicReducedLength({ lat: 0, lon: 0 }, Number.NaN, 1))).toBe("not-finite");
    expect(Object.isFrozen(projection)).toBe(true);
  });
});
