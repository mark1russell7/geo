import { describe, expect, it } from "vitest";
import {
  EARTH_MEAN_RADIUS_KM,
  EARTH_MEAN_RADIUS_METERS,
  GeoError,
  centralAngleRadians,
  destinationKm,
  destinationMeters,
  distanceKm,
  distanceMeters,
  initialBearing,
  type GeoErrorCode,
  type LatLon,
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

/** Degrees, minutes and seconds to degrees. */
const dms = (degrees: number, minutes: number, seconds: number): number => degrees + minutes / 60 + seconds / 3600;
const ARCSECOND = 1 / 3600;

// Public places, the same fixtures as the tests of @procedures/geo.
const EIFFEL: LatLon = { lat: 48.8584, lon: 2.2945 };
const BRANDENBURG: LatLon = { lat: 52.5163, lon: 13.3777 };
const OPERA: LatLon = { lat: -33.8568, lon: 151.2153 };
const LIBERTY: LatLon = { lat: 40.6892, lon: -74.0445 };

describe("the radius", () => {
  it("is the IUGG mean radius R1", () => {
    expect(EARTH_MEAN_RADIUS_KM).toBe(6371.0088);
    expect(EARTH_MEAN_RADIUS_METERS).toBe(6_371_008.8);
  });

  it("must be more than 0", () => {
    for (const radius of [0, -0, -1, -EARTH_MEAN_RADIUS_KM, Number.NEGATIVE_INFINITY]) {
      const expected = Number.isFinite(radius) ? "radius" : "not-finite";
      expect(codeOf(() => distanceKm(EIFFEL, BRANDENBURG, radius))).toBe(expected);
      expect(codeOf(() => distanceMeters(EIFFEL, BRANDENBURG, radius))).toBe(expected);
      expect(codeOf(() => destinationKm(EIFFEL, 0, 10, radius))).toBe(expected);
      expect(codeOf(() => destinationMeters(EIFFEL, 0, 10, radius))).toBe(expected);
    }
    expect(codeOf(() => distanceKm(EIFFEL, BRANDENBURG, Number.MIN_VALUE))).toBeUndefined();
  });

  it("gives an error of approximately 0.6 % against the ellipsoid for 1 degree of latitude at the equator", () => {
    // On the WGS84 ellipsoid, 1 degree of latitude at the equator is 110.574 km.
    const error = Math.abs(distanceKm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) / 110.574 - 1);
    expect(error).toBeGreaterThan(0.005);
    expect(error).toBeLessThan(0.006);
  });
});

describe("distanceKm", () => {
  it("is 0 for the same point", () => {
    expect(distanceKm(EIFFEL, EIFFEL)).toBe(0);
  });

  // Rosetta Code, "Haversine formula": Nashville (BNA) to Los Angeles (LAX) on a sphere of 6372.8 km.
  it("gives the Rosetta Code value for BNA to LAX", () => {
    expect(distanceKm({ lat: 36.12, lon: -86.67 }, { lat: 33.94, lon: -118.4 }, 6372.8)).toBeCloseTo(2887.2599506071106, 9);
  });

  // Movable Type Scripts (Chris Veness), "Calculate distance, bearing and more between latitude/longitude points":
  // Land's End to John o' Groats is 968.9 km on a sphere of 6371 km.
  it("gives the Movable Type value for Land's End to John o' Groats", () => {
    const landsEnd = { lat: dms(50, 3, 59), lon: -dms(5, 42, 53) };
    const johnOGroats = { lat: dms(58, 38, 38), lon: -dms(3, 4, 12) };
    expect(distanceKm(landsEnd, johnOGroats, 6371)).toBeCloseTo(968.9, 1);
  });

  // The values of greatCircleKm in @procedures/geo, with its radius of 6371 km. The formula is the same, so the
  // values are equal to the last bit.
  it("gives the values of greatCircleKm of @procedures/geo with the radius 6371", () => {
    expect(distanceKm(EIFFEL, BRANDENBURG, 6371)).toBe(879.0864603595937);
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, 6371)).toBe(111.19492664455873);
    expect(distanceKm(OPERA, LIBERTY, 6371)).toBe(15984.279726609057);
    expect(distanceKm({ lat: 10, lon: 179.5 }, { lat: 10, lon: -179.5 }, 6371)).toBe(109.50558394369477);
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, 6371)).toBe(20015.086796020572);
    expect(distanceKm({ lat: 90, lon: 0 }, { lat: -90, lon: 0 }, 6371)).toBe(20015.086796020572);
  });

  it("scales with the IUGG radius by default", () => {
    expect(distanceKm(EIFFEL, BRANDENBURG)).toBeCloseTo((879.0864603595937 * 6371.0088) / 6371, 9);
  });

  it("is half the circumference for antipodal points", () => {
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBe(Math.PI * EARTH_MEAN_RADIUS_KM);
  });

  it("gives metres", () => {
    expect(distanceMeters(EIFFEL, BRANDENBURG)).toBeCloseTo(distanceKm(EIFFEL, BRANDENBURG) * 1000, 6);
    expect(distanceMeters(EIFFEL, BRANDENBURG, 6_371_000)).toBeCloseTo(879_086.4603595937, 6);
  });

  it("refuses NaN and a latitude out of the range", () => {
    expect(() => distanceKm({ lat: Number.NaN, lon: 0 }, EIFFEL)).toThrow(GeoError);
    expect(() => distanceKm(EIFFEL, { lat: 0, lon: Number.NaN })).toThrow(GeoError);
    expect(() => distanceKm(EIFFEL, { lat: 91, lon: 0 })).toThrow(GeoError);
    expect(() => distanceKm(EIFFEL, BRANDENBURG, Number.NaN)).toThrow(GeoError);
    expect(() => distanceMeters(EIFFEL, BRANDENBURG, Number.POSITIVE_INFINITY)).toThrow(GeoError);
  });
});

describe("centralAngleRadians", () => {
  // Ed Williams, "Aviation Formulary": LAX (33°57'N, 118°24'W) to JFK (40°38'N, 73°47'W) is 0.623585 radians.
  it("gives the Aviation Formulary value for LAX to JFK", () => {
    const lax = { lat: dms(33, 57, 0), lon: -dms(118, 24, 0) };
    const jfk = { lat: dms(40, 38, 0), lon: -dms(73, 47, 0) };
    expect(centralAngleRadians(lax, jfk)).toBeCloseTo(0.623585, 6);
  });
});

describe("initialBearing", () => {
  // Movable Type Scripts: the initial bearing from Land's End to John o' Groats is 009°07′11″.
  it("gives the Movable Type value", () => {
    const landsEnd = { lat: dms(50, 3, 59), lon: -dms(5, 42, 53) };
    const johnOGroats = { lat: dms(58, 38, 38), lon: -dms(3, 4, 12) };
    expect(Math.abs(initialBearing(landsEnd, johnOGroats) - dms(9, 7, 11))).toBeLessThan(ARCSECOND);
  });

  // Aviation Formulary: the initial course from LAX to JFK is 66 degrees (rounded).
  it("gives the Aviation Formulary course for LAX to JFK", () => {
    const lax = { lat: dms(33, 57, 0), lon: -dms(118, 24, 0) };
    const jfk = { lat: dms(40, 38, 0), lon: -dms(73, 47, 0) };
    expect(Math.round(initialBearing(lax, jfk))).toBe(66);
  });

  it("gives the four directions on the equator and on a meridian", () => {
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBe(0);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBe(90);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: -10, lon: 0 })).toBe(180);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBe(270);
  });

  it("is 0 for two equal points", () => {
    expect(initialBearing(EIFFEL, EIFFEL)).toBe(0);
  });

  it("is 0 for longitudes that are different by a multiple of 360", () => {
    expect(initialBearing({ lat: 10, lon: -180 }, { lat: 10, lon: 180 })).toBe(0);
    expect(initialBearing({ lat: 10, lon: 0 }, { lat: 10, lon: 360 })).toBe(0);
    expect(initialBearing({ lat: 10, lon: 2.5 }, { lat: 10, lon: -357.5 })).toBe(0);
    expect(initialBearing({ lat: 10, lon: 2.5 }, { lat: 10, lon: 722.5 })).toBe(0);
  });

  it("is 0 for two longitudes of the same pole", () => {
    expect(initialBearing({ lat: 90, lon: 0 }, { lat: 90, lon: 50 })).toBe(0);
    expect(initialBearing({ lat: -90, lon: 10 }, { lat: -90, lon: -170 })).toBe(0);
    // From one pole to the other pole is not one point.
    expect(initialBearing({ lat: 90, lon: 0 }, { lat: -90, lon: 0 })).toBe(180);
  });

  it("is from 0 to less than 360", () => {
    const bearing = initialBearing({ lat: 0, lon: 0 }, { lat: 1e-12, lon: -1 });
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });

  it("crosses the antimeridian by the short way", () => {
    expect(initialBearing({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })).toBeCloseTo(90, 9);
  });

  it("is measured from the meridian of the start at a pole", () => {
    // From the north pole on the meridian 0, the meridian 0 goes south, which is the bearing 180.
    expect(initialBearing({ lat: 90, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(180, 9);
    // The meridian 90 east is to the left of that direction: a bearing of 90.
    expect(initialBearing({ lat: 90, lon: 0 }, { lat: 10, lon: 90 })).toBeCloseTo(90, 9);
  });
});

describe("destinationKm", () => {
  // Movable Type Scripts: from 53°19′14″N, 001°43′47″W on the bearing 096°01′18″ for 124.8 km, the destination is
  // 53°11′18″N, 000°08′00″E on a sphere of 6371 km.
  it("gives the Movable Type value", () => {
    const start = { lat: dms(53, 19, 14), lon: -dms(1, 43, 47) };
    const end = destinationKm(start, dms(96, 1, 18), 124.8, 6371);
    expect(Math.abs(end.lat - dms(53, 11, 18))).toBeLessThan(ARCSECOND);
    expect(Math.abs(end.lon - dms(0, 8, 0))).toBeLessThan(ARCSECOND);
  });

  it("goes along the equator and the meridians", () => {
    const quarter = (Math.PI / 2) * EARTH_MEAN_RADIUS_KM;
    const east = destinationKm({ lat: 0, lon: 0 }, 90, quarter);
    expect(east.lat).toBeCloseTo(0, 9);
    expect(east.lon).toBeCloseTo(90, 9);
    const north = destinationKm({ lat: 0, lon: 0 }, 0, quarter);
    expect(north.lat).toBeCloseTo(90, 9);
  });

  it("normalizes the longitude after the antimeridian", () => {
    const end = destinationKm({ lat: 0, lon: 179 }, 90, distanceKm({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }));
    expect(end.lon).toBeCloseTo(-179, 9);
  });

  it("goes along the meridian of the bearing from a pole", () => {
    // From the north pole on the meridian 0, the bearing 180 goes down the meridian 0.
    const end = destinationKm({ lat: 90, lon: 0 }, 180, (Math.PI / 2) * EARTH_MEAN_RADIUS_KM);
    expect(end.lat).toBeCloseTo(0, 9);
    expect(end.lon).toBeCloseTo(0, 9);
    const other = destinationKm({ lat: 90, lon: 0 }, 90, (Math.PI / 2) * EARTH_MEAN_RADIUS_KM);
    expect(other.lon).toBeCloseTo(90, 9);
  });

  it("goes the opposite way for a negative distance", () => {
    const end = destinationKm({ lat: 0, lon: 0 }, 90, -111.19508372419141);
    expect(end.lon).toBeCloseTo(-1, 6);
  });

  it("gives metres", () => {
    const km = destinationKm(EIFFEL, 45, 10);
    const m = destinationMeters(EIFFEL, 45, 10_000);
    expect(m.lat).toBeCloseTo(km.lat, 12);
    expect(m.lon).toBeCloseTo(km.lon, 12);
  });

  it("refuses a bearing, a distance or a radius that is not finite", () => {
    expect(() => destinationKm(EIFFEL, Number.NaN, 1)).toThrow(GeoError);
    expect(() => destinationKm(EIFFEL, 1, Number.NaN)).toThrow(GeoError);
    expect(() => destinationKm(EIFFEL, 1, 1, Number.NaN)).toThrow(GeoError);
    expect(() => destinationMeters(EIFFEL, 1, 1, Number.NaN)).toThrow(GeoError);
    expect(() => destinationMeters({ lat: 95, lon: 0 }, 1, 1)).toThrow(GeoError);
  });
});
