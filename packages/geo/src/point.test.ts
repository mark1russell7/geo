import { describe, expect, it } from "vitest";
import { GeoError, fromPosition, latLon, normalizeLon, parseLatLon, toPosition } from "./index.ts";

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return error.code;
    throw error;
  }
  return undefined;
};

describe("normalizeLon", () => {
  it("keeps a longitude in the range", () => {
    expect(normalizeLon(0)).toBe(0);
    expect(normalizeLon(-180)).toBe(-180);
    expect(normalizeLon(179.999)).toBe(179.999);
    expect(normalizeLon(-73.9857)).toBe(-73.9857);
  });

  it("wraps a longitude out of the range to [-180, 180)", () => {
    expect(normalizeLon(180)).toBe(-180);
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(360)).toBe(0);
    expect(normalizeLon(540)).toBe(-180);
    expect(normalizeLon(-540)).toBe(-180);
    expect(normalizeLon(725)).toBe(5);
  });

  it("refuses NaN and infinite values", () => {
    expect(codeOf(() => normalizeLon(Number.NaN))).toBe("not-finite");
    expect(codeOf(() => normalizeLon(Number.POSITIVE_INFINITY))).toBe("not-finite");
  });
});

describe("latLon", () => {
  it("gives a point with a normalized longitude", () => {
    expect(latLon(48.8584, 2.2945)).toEqual({ lat: 48.8584, lon: 2.2945 });
    expect(latLon(10, 180)).toEqual({ lat: 10, lon: -180 });
    expect(latLon(90, 0)).toEqual({ lat: 90, lon: 0 });
    expect(latLon(-90, 0)).toEqual({ lat: -90, lon: 0 });
  });

  it("refuses a latitude out of the range and a value that is not finite", () => {
    expect(codeOf(() => latLon(90.0001, 0))).toBe("latitude-range");
    expect(codeOf(() => latLon(-91, 0))).toBe("latitude-range");
    expect(codeOf(() => latLon(Number.NaN, 0))).toBe("not-finite");
    expect(codeOf(() => latLon(0, Number.NaN))).toBe("not-finite");
  });

  it("throws a GeoError that is a RangeError", () => {
    let thrown: unknown;
    try {
      latLon(Number.NaN, 0);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GeoError);
    expect(thrown).toBeInstanceOf(RangeError);
    expect((thrown as GeoError).name).toBe("GeoError");
    expect((thrown as GeoError).path).toBe("");
  });
});

describe("parseLatLon", () => {
  it("reads a point from an object", () => {
    const result = parseLatLon(JSON.parse('{"lat": 52.5163, "lon": 373.3777}'));
    expect(result.tag).toBe("ok");
    if (result.tag === "ok") {
      expect(result.value.lat).toBe(52.5163);
      expect(result.value.lon).toBeCloseTo(13.3777, 9);
    }
  });

  it("gives a typed error for an incorrect value", () => {
    const cases: readonly [unknown, string][] = [
      [null, "not-a-point"],
      ["52,13", "not-a-point"],
      [{ lat: 1 }, "not-a-point"],
      [{ lat: "1", lon: 2 }, "not-a-point"],
      [{ lat: Number.NaN, lon: 2 }, "not-finite"],
      [{ lat: 100, lon: 2 }, "latitude-range"],
    ];
    for (const [value, code] of cases) {
      const result = parseLatLon(value);
      expect(result.tag).toBe("err");
      if (result.tag === "err") expect(result.error.code).toBe(code);
    }
  });
});

describe("positions", () => {
  it("writes the longitude first", () => {
    expect(toPosition({ lat: 1, lon: 2 })).toEqual([2, 1]);
  });

  it("reads a position and ignores the altitude", () => {
    expect(fromPosition([2, 1, 300])).toEqual({ lat: 1, lon: 2 });
    expect(fromPosition([190, 1])).toEqual({ lat: 1, lon: -170 });
  });

  it("refuses a short or incorrect position", () => {
    expect(codeOf(() => fromPosition([2]))).toBe("position");
    expect(codeOf(() => fromPosition([2, 95]))).toBe("latitude-range");
  });
});
