import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import { GeoError } from "./errors.ts";
import { geodesicInverse } from "./geodesic.ts";
import { GRS80 } from "./conformal.ts";
import { fromStatePlane, PLANE_UNIT_METERS, STATE_PLANE_ZONES, statePlaneProjection, statePlaneZone, toStatePlane, type PlaneUnit } from "./state-plane.ts";

describe("STATE_PLANE_ZONES", () => {
  it("has one zone for each FIPS code and each EPSG code", () => {
    expect(new Set(STATE_PLANE_ZONES.map((zone) => zone.fips)).size).toBe(STATE_PLANE_ZONES.length);
    expect(new Set(STATE_PLANE_ZONES.map((zone) => zone.epsg)).size).toBe(STATE_PLANE_ZONES.length);
    expect(statePlaneZone("3102")?.name).toBe("New York Central");
    expect(statePlaneZone("9999")).toBeUndefined();
  });

  it("puts the origin of each zone at its false values", () => {
    for (const zone of STATE_PLANE_ZONES) {
      const { latitudeOfOrigin: lat, centralMeridian: lon, falseEasting, falseNorthing } = zone.definition;
      const p = toStatePlane(zone, { lat, lon });
      expect(p.x).toBeCloseTo(falseEasting, 6);
      expect(p.y).toBeCloseTo(falseNorthing, 6);
    }
  });

  it("gives the scale factor of each Transverse Mercator zone on its central meridian", () => {
    for (const zone of STATE_PLANE_ZONES) {
      if (zone.definition.kind !== "transverse-mercator") continue;
      expect(statePlaneProjection(zone).scale({ lat: 43, lon: zone.definition.centralMeridian }).max).toBeCloseTo(zone.definition.scaleFactor, 12);
    }
  });

  it("gives the scale 1 on the standard parallels of New York Long Island", () => {
    const zone = statePlaneZone("3104")!;
    expect(statePlaneProjection(zone).scale({ lat: 40 + 40 / 60, lon: -73 }).max).toBeCloseTo(1, 12);
    expect(statePlaneProjection(zone).scale({ lat: 41 + 2 / 60, lon: -72 }).max).toBeCloseTo(1, 12);
  });

  it("gives the point back from the plane in each unit", () => {
    const units: PlaneUnit[] = ["meter", "us-survey-foot", "international-foot"];
    for (const zone of STATE_PLANE_ZONES) {
      const lat0 = zone.definition.kind === "transverse-mercator" ? 43 : 40.8;
      fc.assert(
        fc.property(uniformDouble({ min: -1.5, max: 1.5 }), uniformDouble({ min: -2, max: 2 }), fc.constantFrom(...units), (dLat, dLon, unit) => {
          const point = { lat: lat0 + dLat, lon: zone.definition.centralMeridian + dLon };
          const back = fromStatePlane(zone, toStatePlane(zone, point, unit), unit);
          expect(geodesicInverse(back, point, GRS80).meters).toBeLessThan(1e-6);
        }),
        { numRuns: 50 },
      );
    }
  });

  it("reads a plane in US survey feet", () => {
    const zone = statePlaneZone("3102")!;
    const meters = toStatePlane(zone, { lat: 42.5, lon: -76.5 });
    const feet = toStatePlane(zone, { lat: 42.5, lon: -76.5 }, "us-survey-foot");
    expect(feet.x * PLANE_UNIT_METERS["us-survey-foot"]).toBeCloseTo(meters.x, 6);
    expect(PLANE_UNIT_METERS["us-survey-foot"]).toBe(1200 / 3937);
    expect(statePlaneProjection(zone).name).toBe("New York Central (SPCS 83, EPSG:32116)");
    expect(statePlaneProjection(zone)).toBe(statePlaneProjection(zone));
  });

  it("refuses a unit that is not a plane unit", () => {
    const zone = statePlaneZone("3101")!;
    expect(() => fromStatePlane(zone, { x: 0, y: 0 }, "yard" as PlaneUnit)).toThrow(GeoError);
  });
});
