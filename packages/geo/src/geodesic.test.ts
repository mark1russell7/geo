import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import {
  GeoError,
  WGS84,
  centralAngleRadians,
  distanceMeters,
  geodesicDirect,
  geodesicInverse,
  type Ellipsoid,
  type GeoErrorCode,
  type GeodesicDirect,
  type GeodesicInverse,
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

/** The difference of two angles in degrees, from 0 to 180. */
const angleGap = (a: number, b: number): number => {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
};

const ellipsoid = (equatorialRadiusMeters: number, flattening: number): Ellipsoid => ({ equatorialRadiusMeters, flattening });

/** The limits of the prediction geo-R9: 1e-6 m for a distance, 1e-9 degree for a bearing, a latitude or a longitude. */
const METERS_LIMIT = 1e-6;
const DEGREES_LIMIT = 1e-9;

/**
 * The 20 test geodesics of `test/geodesictest.js` of geographiclib-geodesic 2.2.0 (MIT, Copyright (c) 2011-2022,
 * Charles Karney). Each row is lat1, lon1, azi1, lat2, lon2, azi2 and s12 (metres). The other columns are not used.
 */
const TESTCASES: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [35.60777, -139.44815, 111.09874842956033, -11.17491, -69.95921, 129.28927088970877, 8935244.56048183],
  [55.52454, 106.05087, 22.0200598809828, 77.03196, 197.18234, 109.11204111067151, 4105086.171392441],
  [-21.97856, 142.59065, -32.44456876433189, 41.84138, 98.56635, -41.84359951440466, 8394328.894657671],
  [-66.99028, 112.2363, 173.73491240878403, -12.70631, 285.90344, 2.512956620913668, 11150344.231208025],
  [-17.42761, 173.34268, -159.03355766119293, -15.84784, 5.93557, -20.78748465153699, 16076603.163118068],
  [32.84994, 48.28919, 150.492927788122, -56.28556, 202.29132, 48.11344939981676, 16727068.943816446],
  [6.96833, 52.74123, 92.58158538631771, -7.39675, 206.17291, 90.72169216592391, 17102477.249695837],
  [-50.56724, -16.30485, -105.43967990759016, -33.56571, -94.97412, -47.34854783565033, 6455670.511866869],
  [-58.93002, -8.90775, 140.96539790250068, -8.91104, 133.13503, 19.255429433416598, 11756066.021986462],
  [-68.82867, -74.28391, 93.77434776311487, -50.63005, -8.36685, 34.65564085411343, 3956936.926063544],
  [-10.62672, -32.0898, -86.42671328674776, 5.883, -134.31681, -80.47378097103487, 11470869.386456301],
  [-21.76221, 166.90563, 29.31942120693643, 48.72884, 213.97627, 43.50867194641017, 9098627.398655491],
  [-19.79938, -174.47484, 71.16727578017154, -11.99349, -154.35109, 65.58909977519923, 2319004.860116939],
  [-11.95887, -116.94513, 92.71261983045255, 4.57352, 7.16501, 78.64960934409585, 13834722.580140138],
  [-87.85331, 85.66836, -65.12031304024275, 66.48646, 16.09921, -4.888658719272296, 17286615.314714465],
  [1.74708, 128.32011, -101.58484363117385, -11.16617, 11.87109, -86.32579329643748, 12942901.124134742],
  [-25.72959, -144.90758, -153.6474686931172, -57.70581, -269.17879, -48.34398315887649, 9413446.745245311],
  [-41.22777, 122.32875, 14.285113402275739, -7.57291, 130.37946, 10.805303085187369, 3812686.035106021],
  [11.01307, 138.25278, 79.43682622782374, 6.62726, 247.05981, 103.70809021552266, 11911190.819018409],
  [-29.47124, 95.14681, -163.77913044168838, -27.46601, -69.15955, -15.90933594555497, 13487015.838114548],
];

/** The largest error of each kind, with the index of its test geodesic. */
class LargestErrors {
  readonly worst = new Map<string, { error: number; index: number }>();

  add(kind: string, error: number, index: number): void {
    const known = this.worst.get(kind);
    if (known === undefined || !(error <= known.error)) this.worst.set(kind, { error, index });
  }

  largest(kind: string): number {
    return this.worst.get(kind)?.error ?? Number.NaN;
  }

  toString(): string {
    return [...this.worst].map(([kind, { error, index }]) => `${kind} ${error} (test geodesic ${index})`).join(", ");
  }
}

describe("geodesicInverse and geodesicDirect on the test geodesics of GeographicLib", () => {
  it("give each distance and bearing of the inverse problem in the limits", () => {
    const errors = new LargestErrors();
    TESTCASES.forEach(([lat1, lon1, azi1, lat2, lon2, azi2, s12], index) => {
      const result = geodesicInverse({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
      errors.add("distance (m)", Math.abs(result.meters - s12), index);
      errors.add("initial bearing (degree)", angleGap(result.initialBearing, azi1), index);
      errors.add("final bearing (degree)", angleGap(result.finalBearing, azi2), index);
    });
    const message = `The largest errors: ${errors}`;
    expect(errors.largest("distance (m)"), message).toBeLessThanOrEqual(METERS_LIMIT);
    expect(errors.largest("initial bearing (degree)"), message).toBeLessThanOrEqual(DEGREES_LIMIT);
    expect(errors.largest("final bearing (degree)"), message).toBeLessThanOrEqual(DEGREES_LIMIT);
  });

  it("give each position and final bearing of the direct problem in the limits", () => {
    const errors = new LargestErrors();
    TESTCASES.forEach(([lat1, lon1, azi1, lat2, lon2, azi2, s12], index) => {
      const result = geodesicDirect({ lat: lat1, lon: lon1 }, azi1, s12);
      errors.add("latitude (degree)", Math.abs(result.point.lat - lat2), index);
      errors.add("longitude (degree)", angleGap(result.point.lon, lon2), index);
      errors.add("final bearing (degree)", angleGap(result.finalBearing, azi2), index);
      expect(result.point.lon).toBeGreaterThanOrEqual(-180);
      expect(result.point.lon).toBeLessThan(180);
    });
    const message = `The largest errors: ${errors}`;
    expect(errors.largest("latitude (degree)"), message).toBeLessThanOrEqual(DEGREES_LIMIT);
    expect(errors.largest("longitude (degree)"), message).toBeLessThanOrEqual(DEGREES_LIMIT);
    expect(errors.largest("final bearing (degree)"), message).toBeLessThanOrEqual(DEGREES_LIMIT);
  });
});

type InverseCase = readonly [name: string, from: LatLon, to: LatLon, ellipsoid: Ellipsoid, azi1: number, azi2: number, s12: number, degrees: number, meters: number];

const PROLATE_150 = ellipsoid(6.4e6, -1 / 150);
const SPHERE = ellipsoid(6.4e6, 0);
const PROLATE_300 = ellipsoid(6.4e6, -1 / 300);

/**
 * The inverse cases of the GeodSolve tests of `test/geodesictest.js` of geographiclib-geodesic 2.2.0, with their
 * published tolerances. GeodSolve12 (f = -1.83) and GeodSolve100 (f = -3) are out of the documented accuracy. They
 * keep the loose tolerances of GeographicLib.
 */
const INVERSE_CASES: readonly InverseCase[] = [
  ["GeodSolve0", { lat: 40.6, lon: -73.8 }, { lat: 49.01666667, lon: 2.55 }, WGS84, 53.47022, 111.59367, 5853226, 0.5e-5, 0.5],
  ["GeodSolve2a", { lat: 0.07476, lon: 0 }, { lat: -0.07476, lon: 180 }, PROLATE_150, 90.00078, 90.00078, 20106193, 0.5e-5, 0.5],
  ["GeodSolve2b", { lat: 0.1, lon: 0 }, { lat: -0.1, lon: 180 }, PROLATE_150, 90.00105, 90.00105, 20106193, 0.5e-5, 0.5],
  ["GeodSolve12", { lat: 0, lon: 0 }, { lat: -10, lon: 160 }, ellipsoid(89.8, -1.83), 120.27, 105.15, 266.7, 1e-2, 1e-1],
  ["GeodSolve33a", { lat: 0, lon: 0 }, { lat: 0, lon: 179 }, WGS84, 90, 90, 19926189, 0.5e-5, 0.5],
  ["GeodSolve33b", { lat: 0, lon: 0 }, { lat: 0, lon: 179.5 }, WGS84, 55.9665, 124.0335, 19980862, 0.5e-5, 0.5],
  ["GeodSolve33c", { lat: 0, lon: 0 }, { lat: 0, lon: 180 }, WGS84, 0, 180, 20003931, 0.5e-5, 0.5],
  ["GeodSolve33d", { lat: 0, lon: 0 }, { lat: 1, lon: 180 }, WGS84, 0, 180, 19893357, 0.5e-5, 0.5],
  ["GeodSolve33e", { lat: 0, lon: 0 }, { lat: 0, lon: 179 }, SPHERE, 90, 90, 19994492, 0.5e-5, 0.5],
  ["GeodSolve33f", { lat: 0, lon: 0 }, { lat: 0, lon: 180 }, SPHERE, 0, 180, 20106193, 0.5e-5, 0.5],
  ["GeodSolve33g", { lat: 0, lon: 0 }, { lat: 1, lon: 180 }, SPHERE, 0, 180, 19994492, 0.5e-5, 0.5],
  ["GeodSolve33h", { lat: 0, lon: 0 }, { lat: 0, lon: 179 }, PROLATE_300, 90, 90, 19994492, 0.5e-5, 0.5],
  ["GeodSolve33i", { lat: 0, lon: 0 }, { lat: 0, lon: 180 }, PROLATE_300, 90, 90, 20106193, 0.5e-5, 0.5],
  ["GeodSolve33j", { lat: 0, lon: 0 }, { lat: 0.5, lon: 180 }, PROLATE_300, 33.02493, 146.97364, 20082617, 0.5e-5, 0.5],
  ["GeodSolve33k", { lat: 0, lon: 0 }, { lat: 1, lon: 180 }, PROLATE_300, 0, 180, 20027270, 0.5e-5, 0.5],
  ["GeodSolve59", { lat: 5, lon: 0.00000000000001 }, { lat: 10, lon: 180 }, WGS84, 0.000000000000035, 179.99999999999996, 18345191.174332713, 1.5e-14, 5e-9],
  ["GeodSolve74", { lat: 54.1589, lon: 15.3872 }, { lat: 54.1591, lon: 15.3877 }, WGS84, 55.723110355, 55.723515675, 39.527686385, 5e-9, 5e-9],
  ["GeodSolve76", { lat: -(41 + 19 / 60), lon: 174 + 49 / 60 }, { lat: 40 + 58 / 60, lon: -(5 + 30 / 60) }, WGS84, 160.39137649664, 19.50042925176, 19960543.857179, 0.5e-11, 0.5e-6],
  ["GeodSolve78", { lat: 27.2, lon: 0 }, { lat: -27.1, lon: 179.5 }, WGS84, 45.82468716758, 134.2277653267, 19974354.765767, 0.5e-11, 0.5e-6],
  ["GeodSolve92", { lat: 37.757540000000006, lon: -122.47018 }, { lat: 37.75754, lon: -122.470177 }, WGS84, 89.99999923, 90.00000106, 0.264, 1e-7, 0.5e-3],
  ["GeodSolve99", { lat: 45, lon: 0 }, { lat: -45, lon: 179.572719 }, WGS84, 90.00000028, 90.00000028, 19987083.007, 1e-8, 0.5e-3],
  ["GeodSolve100", { lat: 30, lon: 0 }, { lat: 30, lon: 180 }, ellipsoid(1e6, -3), 22.368806, 157.631194, 1074081.6, 1, 1e3],
];

/** The inverse cases of GeodSolve that test only the distance, with their published tolerances. */
const DISTANCE_CASES: readonly (readonly [name: string, from: LatLon, to: LatLon, s12: number, meters: number])[] = [
  ["GeodSolve4", { lat: 36.493349428792, lon: 0 }, { lat: 36.49334942879201, lon: 0.0000008 }, 0.072, 0.5e-3],
  ["GeodSolve6a", { lat: 88.202499451857, lon: 0 }, { lat: -88.202499451857, lon: 179.981022032992859592 }, 20003898.214, 0.5e-3],
  ["GeodSolve6b", { lat: 89.262080389218, lon: 0 }, { lat: -89.262080389218, lon: 179.992207982775375662 }, 20003925.854, 0.5e-3],
  ["GeodSolve6c", { lat: 89.333123580033, lon: 0 }, { lat: -89.333123580032997687, lon: 179.99295812360148422 }, 20003926.881, 0.5e-3],
  ["GeodSolve9", { lat: 56.320923501171, lon: 0 }, { lat: -56.320923501171, lon: 179.664747671772880215 }, 19993558.287, 0.5e-3],
  ["GeodSolve10", { lat: 52.784459512564, lon: 0 }, { lat: -52.784459512563990912, lon: 179.634407464943777557 }, 19991596.095, 0.5e-3],
  ["GeodSolve11", { lat: 48.522876735459, lon: 0 }, { lat: -48.52287673545898293, lon: 179.599720456223079643 }, 19989144.774, 0.5e-3],
  ["GeodSolve29", { lat: 0, lon: 539 }, { lat: 0, lon: 181 }, 222639, 0.5],
];

type DirectCase = readonly [name: string, from: LatLon, azi1: number, s12: number, lat2: number, lon2: number, azi2: number, degrees: number];

/** The direct cases of GeodSolve on WGS84, with their published tolerances. */
const DIRECT_CASES: readonly DirectCase[] = [
  ["GeodSolve1", { lat: 40.63972222, lon: -73.77888889 }, 53.5, 5850e3, 49.01467, 2.56106, 111.62947, 0.5e-5],
  ["GeodSolve17", { lat: 40, lon: -75 }, -10, 2e7, -39, 105, -170, 1],
  ["GeodSolve61", { lat: 45, lon: 0 }, -0.000000000000000003, 1e7, 45.30632, -180, 180, 0.5e-5],
  ["GeodSolve71", { lat: 1, lon: 2 }, 45, 5e6, 30.92625, 37.5464, 55.43104, 0.5e-5],
  ["GeodSolve73", { lat: 90, lon: 10 }, 180, -1e6, 81.04623, -170, 0, 0.5e-5],
];

const expectDirect = (name: string, result: GeodesicDirect, lat2: number, lon2: number, azi2: number, degrees: number): void => {
  expect(Math.abs(result.point.lat - lat2), `${name} latitude`).toBeLessThanOrEqual(degrees);
  expect(angleGap(result.point.lon, lon2), `${name} longitude`).toBeLessThanOrEqual(degrees);
  expect(angleGap(result.finalBearing, azi2), `${name} final bearing`).toBeLessThanOrEqual(degrees);
};

describe("geodesicInverse and geodesicDirect on the GeodSolve tests of GeographicLib", () => {
  it.each(INVERSE_CASES)("%s: the inverse problem", (name, from, to, shape, azi1, azi2, s12, degrees, meters) => {
    const result = geodesicInverse(from, to, shape);
    expect(angleGap(result.initialBearing, azi1), `${name} initial bearing`).toBeLessThanOrEqual(degrees);
    expect(angleGap(result.finalBearing, azi2), `${name} final bearing`).toBeLessThanOrEqual(degrees);
    expect(Math.abs(result.meters - s12), `${name} distance`).toBeLessThanOrEqual(meters);
  });

  it.each(DISTANCE_CASES)("%s: the distance of the inverse problem", (name, from, to, s12, meters) => {
    expect(Math.abs(geodesicInverse(from, to).meters - s12), name).toBeLessThanOrEqual(meters);
  });

  it.each(DIRECT_CASES)("%s: the direct problem", (name, from, azi1, s12, lat2, lon2, azi2, degrees) => {
    expectDirect(name, geodesicDirect(from, azi1, s12), lat2, lon2, azi2, degrees);
  });

  it("GeodSolve5: goes to the north pole from near the equator", () => {
    const result = geodesicDirect({ lat: 0.01777745589997, lon: 30 }, 0, 10e6);
    if (result.point.lon < 0) expectDirect("GeodSolve5", result, 90, -150, 180, 0.5e-5);
    else expectDirect("GeodSolve5", result, 90, 30, 0, 0.5e-5);
  });

  it("GeodSolve65 and GeodSolve69: go along the geodesic of an inverse result", () => {
    const from65 = { lat: 30, lon: -0.000000000000000001 };
    const line65 = geodesicInverse(from65, { lat: -31, lon: 180 });
    expect(angleGap(line65.initialBearing, 180)).toBeLessThanOrEqual(0.5e-5);
    expectDirect("GeodSolve65a", geodesicDirect(from65, line65.initialBearing, 1e7), -60.23169, 0, 180, 0.5e-5);
    expectDirect("GeodSolve65b", geodesicDirect(from65, line65.initialBearing, 2e7), -30.03547, -180, 0, 0.5e-5);
    const from69 = { lat: -5, lon: -0.000000000000002 };
    const line69 = geodesicInverse(from69, { lat: -10, lon: 180 });
    expectDirect("GeodSolve69a", geodesicDirect(from69, line69.initialBearing, 2e7), 4.96445, -180, 0, 0.5e-5);
    expectDirect("GeodSolve69b", geodesicDirect(from69, line69.initialBearing, line69.meters / 2), -87.52461, 0, 180, 0.5e-5);
  });

  it("GeodSolve73: gives a final bearing of +0, not -0", () => {
    expect(Object.is(geodesicDirect({ lat: 90, lon: 10 }, 180, -1e6).finalBearing, 0)).toBe(true);
  });

  it("GeodSolve80: gives a length of +0 and bearings of 0 for two equal points", () => {
    for (const [from, to] of [
      [{ lat: 20.001, lon: 0 }, { lat: 20.001, lon: 0 }],
      [{ lat: 90, lon: 0 }, { lat: 90, lon: 180 }],
      [{ lat: -10, lon: 190 }, { lat: -10, lon: -170 }],
    ] as const) {
      const result = geodesicInverse(from, to);
      expect(result).toEqual({ meters: 0, initialBearing: 0, finalBearing: 0 });
      expect(Object.is(result.meters, 0)).toBe(true);
    }
  });
});

describe("geodesicInverse and geodesicDirect on other cases", () => {
  // The values come from geographiclib-geodesic 2.2.0 for the same inputs. The port gives the same bits.
  it.each([
    ["the flattening 1/60", ellipsoid(6378137, 1 / 60), { lat: 10, lon: 20 }, { lat: -12, lon: 195 }, 19406930.89823273, 126.98388939488984, 53.52051078582943],
    ["the flattening -1/60", ellipsoid(6378137, -1 / 60), { lat: 10, lon: 20 }, { lat: -9, lon: 197 }, 19702937.93582133, 80.45515915861152, 100.52157698916716],
    ["almost antipodal points far from the cut", WGS84, { lat: 30, lon: 0 }, { lat: -29.98, lon: 179.8 }, 19998183.154845607, 21.431037890143813, 158.57346941127787],
    ["a short line near the pole", WGS84, { lat: 89.9999999, lon: 0 }, { lat: 89.9999999, lon: 170 }, 0.022253788727947192, 4.999999999999997, 175],
    ["almost antipodal points on a prolate ellipsoid", PROLATE_150, { lat: 30, lon: 0 }, { lat: -29.9, lon: 179.8 }, 20103214.24179005, 84.91124790493434, 95.70476248230995],
    ["the flattening -1/50", ellipsoid(6.4e6, -1 / 50), { lat: 5, lon: 0 }, { lat: -4.99, lon: 179.9 }, 20096651.26240873, 89.99827697770614, 90.32275468875639],
  ] as const)("the inverse problem: %s", (_name, shape, from, to, s12, azi1, azi2) => {
    const result: GeodesicInverse = geodesicInverse(from, to, shape);
    expect(Math.abs(result.meters - s12)).toBeLessThanOrEqual(METERS_LIMIT);
    expect(angleGap(result.initialBearing, azi1)).toBeLessThanOrEqual(DEGREES_LIMIT);
    expect(angleGap(result.finalBearing, azi2)).toBeLessThanOrEqual(DEGREES_LIMIT);
  });

  it.each([
    ["the flattening 1/60", ellipsoid(6378137, 1 / 60), { lat: 10, lon: 20 }, 30, 1.2e7, 49.37258537422822, 153.02239398171847, 131.46497930854844],
    ["the flattening -1/60", ellipsoid(6378137, -1 / 60), { lat: -10, lon: 20 }, 120, 1.5e7, -13.678667936317737, 161.10432480406268, 61.41927887903863],
  ] as const)("the direct problem: %s", (name, shape, from, azi1, s12, lat2, lon2, azi2) => {
    expectDirect(name, geodesicDirect(from, azi1, s12, shape), lat2, lon2, azi2, DEGREES_LIMIT);
  });

  it("gives the length of a geodesic of one bit of latitude along a meridian", () => {
    const result = geodesicInverse({ lat: 10, lon: 5 }, { lat: 10.000000000000002, lon: 5 });
    expect(Math.abs(result.meters - 1.7638703613571895e-10)).toBeLessThan(1e-20);
    expect(result.initialBearing).toBe(0);
    expect(result.finalBearing).toBe(0);
  });

  it("goes around the ellipsoid more than one time, and goes back for a negative distance", () => {
    const along = geodesicDirect({ lat: 0, lon: 0 }, 90, 4e7);
    expect(along.point.lat).toBe(0);
    expect(along.finalBearing).toBe(90);
    const equator = 2 * Math.PI * WGS84.equatorialRadiusMeters;
    expect(Math.abs(along.point.lon + ((equator - 4e7) / equator) * 360)).toBeLessThan(1e-9);
    const back = geodesicDirect({ lat: 0, lon: 0 }, 90, -1e6);
    const forward = geodesicDirect({ lat: 0, lon: 0 }, 270, 1e6);
    expect(Math.abs(back.point.lon - forward.point.lon)).toBeLessThan(1e-9);
    expect(back.finalBearing).toBe(90);
  });

  it("refuses an incorrect point, bearing or distance", () => {
    const origin = { lat: 0, lon: 0 };
    expect(codeOf(() => geodesicDirect(origin, 90, Number.POSITIVE_INFINITY))).toBe("not-finite");
    expect(codeOf(() => geodesicDirect(origin, 90, Number.NaN))).toBe("not-finite");
    expect(codeOf(() => geodesicDirect(origin, Number.POSITIVE_INFINITY, 1000))).toBe("not-finite");
    expect(codeOf(() => geodesicDirect(origin, Number.NaN, 1000))).toBe("not-finite");
    expect(codeOf(() => geodesicDirect({ lat: 0, lon: Number.POSITIVE_INFINITY }, 90, 1000))).toBe("not-finite");
    expect(codeOf(() => geodesicDirect({ lat: Number.NaN, lon: 0 }, 90, 1000))).toBe("not-finite");
    expect(codeOf(() => geodesicDirect({ lat: 91, lon: 0 }, 90, 1000))).toBe("latitude-range");
    expect(codeOf(() => geodesicInverse(origin, { lat: 1, lon: Number.NaN }))).toBe("not-finite");
    expect(codeOf(() => geodesicInverse({ lat: Number.NaN, lon: 0 }, { lat: 0, lon: 90 }))).toBe("not-finite");
    expect(codeOf(() => geodesicInverse(origin, { lat: -90.5, lon: 0 }))).toBe("latitude-range");
    expect(() => geodesicDirect(origin, 90, Number.NaN)).toThrow("The distance NaN is not a finite number");
    expect(() => geodesicDirect(origin, Number.NaN, 1)).toThrow("The bearing NaN is not a finite number");
  });

  it("refuses an incorrect ellipsoid", () => {
    const from = { lat: 0, lon: 0 };
    const to = { lat: 1, lon: 1 };
    expect(codeOf(() => geodesicInverse(from, to, ellipsoid(0, 0)))).toBe("radius");
    expect(codeOf(() => geodesicInverse(from, to, ellipsoid(-1, 0)))).toBe("radius");
    expect(codeOf(() => geodesicInverse(from, to, ellipsoid(Number.NaN, 0)))).toBe("not-finite");
    expect(codeOf(() => geodesicInverse(from, to, ellipsoid(1, Number.POSITIVE_INFINITY)))).toBe("not-finite");
    expect(codeOf(() => geodesicInverse(from, to, ellipsoid(1, 1)))).toBe("radius");
    expect(codeOf(() => geodesicDirect(from, 0, 1, ellipsoid(1, 2)))).toBe("radius");
    // The polar radius 1e308 * 11 is not finite.
    expect(codeOf(() => geodesicInverse(from, to, ellipsoid(1e308, -10)))).toBe("radius");
    // The polar radius 5e-324 * 0.4 rounds to 0.
    expect(codeOf(() => geodesicInverse(from, to, ellipsoid(5e-324, 0.6)))).toBe("radius");
    expect(() => geodesicInverse(from, to, ellipsoid(1, 1))).toThrow("The flattening 1 must be less than 1");
  });

  it("sees a change of an ellipsoid after a first use", () => {
    const shape = { equatorialRadiusMeters: 6.4e6, flattening: 0 };
    const first = geodesicInverse({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, shape).meters;
    shape.equatorialRadiusMeters = 3.2e6;
    expect(geodesicInverse({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, shape).meters).toBeCloseTo(first / 2, 6);
    shape.flattening = 1;
    expect(codeOf(() => geodesicInverse({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, shape))).toBe("radius");
  });

  it("has a frozen WGS84", () => {
    expect(WGS84).toEqual({ equatorialRadiusMeters: 6378137, flattening: 1 / 298.257223563 });
    expect(Object.isFrozen(WGS84)).toBe(true);
  });
});

const lat = fc.oneof(uniformDouble({ min: -90, max: 90 }), fc.constantFrom(-90, -45, -30, 0, 30, 45, 90));
const lon = fc.oneof(uniformDouble({ min: -180, max: 180 }), fc.constantFrom(-180, -90, 0, 90, 179.5, 180));
const point: fc.Arbitrary<LatLon> = fc.record({ lat, lon });

/** Two points: random points, almost antipodal points, or very near points. */
const pair: fc.Arbitrary<readonly [LatLon, LatLon]> = fc.oneof(
  fc.tuple(point, point),
  fc.tuple(point, uniformDouble({ min: -0.5, max: 0.5 }), uniformDouble({ min: -1, max: 1 })).map(([a, dLat, dLon]): readonly [LatLon, LatLon] => [
    a,
    { lat: Math.max(-90, Math.min(90, -a.lat + dLat)), lon: a.lon + 180 + dLon },
  ]),
  fc.tuple(point, uniformDouble({ min: -1e-3, max: 1e-3 }), uniformDouble({ min: -1e-3, max: 1e-3 })).map(([a, dLat, dLon]): readonly [LatLon, LatLon] => [
    a,
    { lat: Math.max(-90, Math.min(90, a.lat + dLat)), lon: a.lon + dLon },
  ]),
);

/** Ellipsoids in the documented accuracy: an absolute flattening of 1/50 or less. */
const anyEllipsoid = fc.constantFrom(WGS84, ellipsoid(6.4e6, 1 / 150), ellipsoid(6.4e6, -1 / 150), ellipsoid(6378137, 1 / 50), ellipsoid(6378137, -1 / 50), ellipsoid(6378137, 0));

describe("geodesic properties", () => {
  it("the direct problem of an inverse result gives the second point back", () => {
    fc.assert(
      fc.property(pair, anyEllipsoid, ([from, to], ellipsoidOf) => {
        const inverse = geodesicInverse(from, to, ellipsoidOf);
        const back = geodesicDirect(from, inverse.initialBearing, inverse.meters, ellipsoidOf);
        expect(geodesicInverse(back.point, to, ellipsoidOf).meters, JSON.stringify({ from, to, inverse, back })).toBeLessThanOrEqual(METERS_LIMIT);
      }),
      { numRuns: 300 },
    );
  });

  it("the sphere distance is within 0.6 % of the distance on WGS84, for points that are not almost antipodal", () => {
    fc.assert(
      fc.property(point, point, (a, b) => {
        fc.pre(centralAngleRadians(a, b) < Math.PI - (Math.PI / 180) * 1);
        const meters = geodesicInverse(a, b).meters;
        fc.pre(meters > 1);
        expect(Math.abs(distanceMeters(a, b) / meters - 1), JSON.stringify({ a, b })).toBeLessThanOrEqual(0.006);
      }),
      { numRuns: 300 },
    );
  });

  it("gives bearings from 0 to less than 360 and a normalized longitude", () => {
    fc.assert(
      fc.property(point, uniformDouble({ min: -720, max: 720 }), uniformDouble({ min: -1e8, max: 1e8 }), anyEllipsoid, (from, bearing, meters, ellipsoidOf) => {
        const result = geodesicDirect(from, bearing, meters, ellipsoidOf);
        expect(result.finalBearing).toBeGreaterThanOrEqual(0);
        expect(result.finalBearing).toBeLessThan(360);
        expect(result.point.lon).toBeGreaterThanOrEqual(-180);
        expect(result.point.lon).toBeLessThan(180);
        const inverse = geodesicInverse(from, result.point, ellipsoidOf);
        for (const value of [inverse.initialBearing, inverse.finalBearing]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThan(360);
        }
      }),
    );
  });
});
