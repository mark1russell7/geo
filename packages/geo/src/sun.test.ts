import { describe, expect, it } from "vitest";
import { GeoError } from "./errors.ts";
import { latLon } from "./point.ts";
import { SUNRISE_ALTITUDE_DEG, sunDay, sunPosition, type SunDay } from "./sun.ts";

const HOUR_MS = 3_600_000;
const at = (iso: string): number => Date.parse(iso);
const hours = (day: SunDay): number => day.daylightHours;

/**
 * The fit of the equation of time on the Wikipedia page "Equation of time" (revision 1381509323, section "Mathematical
 * description"), in minutes. `d` is the count of days from January 1 of the year `y`. It is a second method, with its own constants.
 */
function fitEquationOfTime(y: number, d: number): number {
  const D = 6.24004077 + 0.01720197 * (365.25 * (y - 2000) + d);
  return -7.659 * Math.sin(D) + 9.863 * Math.sin(2 * D + 3.5932);
}

describe("sunPosition", () => {
  it("gives a declination that reaches the obliquity at the June solstice and 0 near the March equinox", () => {
    // The largest declination is asin(sin ε sin 90°) = ε, near 23.439 degrees in 2026.
    let most = -90;
    for (let hour = 0; hour < 24 * 10; hour++) most = Math.max(most, sunPosition(at("2026-06-16T00:00Z") + hour * HOUR_MS).declinationDeg);
    expect(most).toBeCloseTo(23.439 - 0.0000004 * 9668, 3);
    expect(sunPosition(at("2026-03-19T00:00Z")).declinationDeg).toBeLessThan(0);
    expect(sunPosition(at("2026-03-21T00:00Z")).declinationDeg).toBeGreaterThan(0);
  });

  it("gives an equation of time that agrees with a second method within 1 minute for each day of a year", () => {
    let worst = 0;
    for (let d = 0; d < 365; d++) {
      const ours = sunPosition(Date.UTC(2026, 0, 1 + d, 12)).equationOfTimeMin;
      worst = Math.max(worst, Math.abs(ours - fitEquationOfTime(2026, d)));
    }
    expect(worst).toBeLessThan(1);
  });

  it("gives a right ascension from 0 to less than 360, and refuses an instant that is not finite", () => {
    for (let d = 0; d < 365; d += 7) {
      const { rightAscensionDeg } = sunPosition(Date.UTC(2026, 0, 1 + d));
      expect(rightAscensionDeg).toBeGreaterThanOrEqual(0);
      expect(rightAscensionDeg).toBeLessThan(360);
    }
    expect(() => sunPosition(Number.NaN)).toThrow(GeoError);
  });
});

describe("sunDay", () => {
  it("gives a sunrise before the solar noon and a sunset after it, with the noon near 12:00 UTC at the longitude 0", () => {
    const day = sunDay(latLon(51.48, 0), "2026-11-24");
    if (day.kind !== "rise-set") throw new Error(day.kind);
    expect(day.rise).toBeLessThan(day.noon);
    expect(day.set).toBeGreaterThan(day.noon);
    expect(Math.abs(day.noon - at("2026-11-24T12:00Z"))).toBeLessThan(17 * 60_000);
    // The equation of time is near +13 minutes in late November, so the solar noon is before 12:00.
    expect(day.noon).toBeLessThan(at("2026-11-24T12:00Z"));
  });

  it("moves the solar noon 1 hour later for each 15 degrees to the west", () => {
    const east = sunDay(latLon(40, 0), "2026-04-10");
    const west = sunDay(latLon(40, -75), "2026-04-10");
    expect((west.noon - east.noon) / HOUR_MS).toBeCloseTo(5, 2);
  });

  it("gives about 12 hours of day at the equator, and more with the refraction", () => {
    for (const date of ["2026-01-15", "2026-03-20", "2026-06-21", "2026-09-23", "2026-12-21"]) {
      expect(hours(sunDay(latLon(0, 10), date, { altitudeDeg: 0 }))).toBeCloseTo(12, 1);
      const refracted = hours(sunDay(latLon(0, 10), date));
      expect(refracted).toBeGreaterThan(12.1);
      expect(refracted).toBeLessThan(12.15);
    }
  });

  it("gives days at a latitude and at its opposite that sum to 24 hours with the altitude 0", () => {
    for (const lat of [15, 35, 50, 60]) {
      for (const date of ["2026-02-10", "2026-06-21", "2026-11-24"]) {
        const sum = hours(sunDay(latLon(lat, 20), date, { altitudeDeg: 0 })) + hours(sunDay(latLon(-lat, 20), date, { altitudeDeg: 0 }));
        expect(Math.abs(sum - 24) * 60).toBeLessThan(2);
      }
    }
  });

  it("gives a longer day in the summer of each half of the Earth", () => {
    expect(hours(sunDay(latLon(45, 0), "2026-06-21"))).toBeGreaterThan(15);
    expect(hours(sunDay(latLon(45, 0), "2026-12-21"))).toBeLessThan(9);
    expect(hours(sunDay(latLon(-45, 0), "2026-12-21"))).toBeGreaterThan(15);
  });

  it("gives a polar day and a polar night, also at a pole", () => {
    expect(sunDay(latLon(80, 15), "2026-06-21").kind).toBe("polar-day");
    expect(sunDay(latLon(80, 15), "2026-12-21").kind).toBe("polar-night");
    expect(sunDay(latLon(-80, 15), "2026-06-21").kind).toBe("polar-night");
    expect(sunDay(latLon(90, 0), "2026-06-21")).toMatchObject({ kind: "polar-day", daylightHours: 24 });
    expect(sunDay(latLon(-90, 0), "2026-06-21")).toMatchObject({ kind: "polar-night", daylightHours: 0 });
    expect(sunDay(latLon(70, 25), "2026-03-20").kind).toBe("rise-set");
  });

  it("gives a longer light for a lower altitude, for example civil twilight", () => {
    const sun = hours(sunDay(latLon(40, -75), "2026-11-24"));
    const civil = hours(sunDay(latLon(40, -75), "2026-11-24", { altitudeDeg: -6 }));
    expect(civil - sun).toBeGreaterThan(0.8);
    expect(SUNRISE_ALTITUDE_DEG).toBe(-0.833);
  });

  it("refuses an incorrect date, altitude or point", () => {
    const code = (run: () => unknown): string | undefined => {
      try {
        run();
      } catch (error) {
        return error instanceof GeoError ? error.code : "other";
      }
      return undefined;
    };
    expect(code(() => sunDay(latLon(0, 0), "2026-02-30"))).toBe("date");
    expect(code(() => sunDay(latLon(0, 0), "2026-2-3"))).toBe("date");
    expect(code(() => sunDay(latLon(0, 0), 20261124 as never))).toBe("date");
    expect(code(() => sunDay(latLon(0, 0), "2026-11-24", { altitudeDeg: 95 }))).toBe("altitude");
    expect(code(() => sunDay(latLon(0, 0), "2026-11-24", { altitudeDeg: Number.NaN }))).toBe("altitude");
    expect(code(() => sunDay({ lat: 91, lon: 0 }, "2026-11-24"))).toBe("latitude-range");
  });
});
