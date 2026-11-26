import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import { lambertConformalConic, transverseMercator, conformalProjection, GRS80, type LambertConformalConicDefinition, type TransverseMercatorDefinition } from "./conformal.ts";
import { GeoError } from "./errors.ts";
import { geodesicInverse, type Ellipsoid } from "./geodesic.ts";
import type { LatLon } from "./point.ts";

const dms = (d: number, m: number, s = 0): number => Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);
const SURVEY_FOOT = 1200 / 3937;
const AIRY_1830: Ellipsoid = { equatorialRadiusMeters: 6_377_563.396, flattening: 1 / 299.3249646 };
const CLARKE_1866: Ellipsoid = { equatorialRadiusMeters: 6_378_206.4, flattening: 1 / 294.97869821 };

/** The British National Grid (EPSG:27700) on the Airy 1830 ellipsoid. */
const BRITISH_GRID: TransverseMercatorDefinition = {
  kind: "transverse-mercator",
  latitudeOfOrigin: 49,
  centralMeridian: -2,
  scaleFactor: 0.9996012717,
  falseEasting: 400_000,
  falseNorthing: -100_000,
  ellipsoid: AIRY_1830,
};

/** NAD27 / Texas South Central (EPSG:32040), the worked example of the method 9802 in the EPSG guidance note 7-2. */
const TEXAS_SOUTH_CENTRAL: LambertConformalConicDefinition = {
  kind: "lambert-conformal-conic",
  standardParallel1: dms(28, 23),
  standardParallel2: dms(30, 17),
  latitudeOfOrigin: dms(27, 50),
  centralMeridian: -99,
  falseEasting: 2_000_000 * SURVEY_FOOT,
  falseNorthing: 0,
  ellipsoid: CLARKE_1866,
};

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return error.code;
    throw error;
  }
  return undefined;
}

describe("transverseMercator", () => {
  const grid = transverseMercator(BRITISH_GRID);

  it("gives the worked example of the EPSG guidance note 7-2 to 1 cm", () => {
    const p = grid.toPlane({ lat: 50.5, lon: 0.5 });
    expect(Math.abs(p.x - 577_274.99)).toBeLessThan(0.01);
    expect(Math.abs(p.y - 69_740.5)).toBeLessThan(0.01);
  });

  it("gives the worked example of the Ordnance Survey to 1 mm, and the point back", () => {
    const point = { lat: dms(52, 39, 27.2531), lon: dms(1, 43, 4.5177) };
    const p = grid.toPlane(point);
    expect(Math.abs(p.x - 651_409.903)).toBeLessThan(0.001);
    expect(Math.abs(p.y - 313_177.27)).toBeLessThan(0.001);
    const back = grid.fromPlane({ x: 651_409.903, y: 313_177.27 });
    expect(geodesicInverse(back, point, AIRY_1830).meters).toBeLessThan(0.001);
  });

  it("puts the natural origin at the false values", () => {
    const p = grid.toPlane({ lat: 49, lon: -2 });
    expect(p.x).toBeCloseTo(400_000, 6);
    expect(p.y).toBeCloseTo(-100_000, 6);
    expect(grid.fromPlane({ x: 400_000, y: -100_000 }).lat).toBeCloseTo(49, 12);
  });

  it("gives the point back from the plane within 10 degrees of the central meridian", () => {
    const tm = transverseMercator({ kind: "transverse-mercator", latitudeOfOrigin: 0, centralMeridian: -75, scaleFactor: 0.9996, falseEasting: 500_000, falseNorthing: 0 });
    fc.assert(
      fc.property(uniformDouble({ min: -84, max: 84 }), uniformDouble({ min: -85, max: -65 }), (lat, lon) => {
        const point: LatLon = { lat, lon };
        const back = tm.fromPlane(tm.toPlane(point));
        expect(geodesicInverse(back, point, GRS80).meters).toBeLessThan(1e-6);
      }),
      { numRuns: 300 },
    );
  });

  it("gives the scale factor on the central meridian, and the scale of a short line", () => {
    expect(grid.scale({ lat: 55, lon: -2 }).max).toBeCloseTo(0.9996012717, 12);
    expect(grid.scale({ lat: 90, lon: 0 }).max).toBeCloseTo(0.9996012717, 9);
    for (const point of [{ lat: 51, lon: 1.5 }, { lat: 58, lon: -6 }, { lat: 20, lon: 15 }]) {
      const { max, min } = grid.scale(point);
      expect(max).toBe(min);
      const east = { lat: point.lat, lon: point.lon + 1e-5 };
      const a = grid.toPlane(point);
      const b = grid.toPlane(east);
      const plane = Math.hypot(b.x - a.x, b.y - a.y);
      expect(plane / geodesicInverse(point, east, AIRY_1830).meters).toBeCloseTo(max, 7);
    }
  });

  it("refuses an incorrect definition and a point with no finite point", () => {
    expect(code(() => transverseMercator({ ...BRITISH_GRID, scaleFactor: 0 }))).toBe("projection");
    expect(code(() => transverseMercator({ ...BRITISH_GRID, latitudeOfOrigin: 91 }))).toBe("latitude-range");
    expect(code(() => transverseMercator({ ...BRITISH_GRID, falseEasting: Number.NaN }))).toBe("not-finite");
    expect(code(() => grid.toPlane({ lat: 0, lon: 88 }))).toBe("projection");
    expect(code(() => grid.fromPlane({ x: Number.POSITIVE_INFINITY, y: 0 }))).toBe("not-finite");
  });
});

describe("lambertConformalConic", () => {
  const texas = lambertConformalConic(TEXAS_SOUTH_CENTRAL);

  it("gives the worked example of the EPSG guidance note 7-2 to 0.01 US survey foot", () => {
    const p = texas.toPlane({ lat: 28.5, lon: -96 });
    expect(Math.abs(p.x / SURVEY_FOOT - 2_963_503.91)).toBeLessThan(0.01);
    expect(Math.abs(p.y / SURVEY_FOOT - 254_759.8)).toBeLessThan(0.01);
    const back = texas.fromPlane({ x: 2_963_503.91 * SURVEY_FOOT, y: 254_759.8 * SURVEY_FOOT });
    expect(back.lat).toBeCloseTo(28.5, 7);
    expect(back.lon).toBeCloseTo(-96, 7);
  });

  it("has the scale 1 on each standard parallel, and less between them", () => {
    expect(texas.scale({ lat: dms(28, 23), lon: -97 }).max).toBeCloseTo(1, 12);
    expect(texas.scale({ lat: dms(30, 17), lon: -101 }).max).toBeCloseTo(1, 12);
    expect(texas.scale({ lat: 29.3, lon: -99 }).max).toBeLessThan(1);
    expect(texas.scale({ lat: 25, lon: -99 }).max).toBeGreaterThan(1);
  });

  it("gives the point back from the plane, also in the south", () => {
    const south = conformalProjection({ ...TEXAS_SOUTH_CENTRAL, standardParallel1: -28, standardParallel2: -36, latitudeOfOrigin: -32, centralMeridian: 135 });
    for (const [projection, lat0, lon0] of [[texas, 29, -99], [south, -32, 135]] as const) {
      fc.assert(
        fc.property(uniformDouble({ min: -10, max: 10 }), uniformDouble({ min: -15, max: 15 }), (dLat, dLon) => {
          const point: LatLon = { lat: lat0 + dLat, lon: lon0 + dLon };
          const back = projection.fromPlane(projection.toPlane(point));
          expect(geodesicInverse(back, point, CLARKE_1866).meters).toBeLessThan(1e-6);
        }),
        { numRuns: 200 },
      );
    }
  });

  it("takes one standard parallel two times, as a cone that touches it", () => {
    const one = lambertConformalConic({ ...TEXAS_SOUTH_CENTRAL, standardParallel1: 29, standardParallel2: 29 });
    expect(one.scale({ lat: 29, lon: -90 }).max).toBeCloseTo(1, 12);
  });

  it("refuses a definition with no cone, and the poles", () => {
    expect(code(() => lambertConformalConic({ ...TEXAS_SOUTH_CENTRAL, standardParallel1: 30, standardParallel2: -30 }))).toBe("projection");
    expect(code(() => lambertConformalConic({ ...TEXAS_SOUTH_CENTRAL, standardParallel1: 90 }))).toBe("latitude-range");
    expect(code(() => texas.toPlane({ lat: -90, lon: 0 }))).toBe("latitude-range");
    expect(code(() => texas.scale({ lat: 90, lon: 0 }))).toBe("latitude-range");
  });
});
