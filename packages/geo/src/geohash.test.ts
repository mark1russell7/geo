import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEOHASH_PRECISION,
  GEOHASH_ALPHABET,
  GeoError,
  MAX_GEOHASH_PRECISION,
  decodeGeohash,
  geohash,
  geohashNeighbor,
  geohashNeighbors,
  geohashesInBBox,
  type GeoErrorCode,
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

// Public places, the same fixtures as the tests of @procedures/geo.
const EIFFEL = { lat: 48.8584, lon: 2.2945 };
const OPERA = { lat: -33.8568, lon: 151.2153 };
const LIBERTY = { lat: 40.6892, lon: -74.0445 };

describe("the constants", () => {
  it("are the constants of @procedures/geo", () => {
    expect(GEOHASH_ALPHABET).toBe("0123456789bcdefghjkmnpqrstuvwxyz");
    expect(DEFAULT_GEOHASH_PRECISION).toBe(7);
    expect(MAX_GEOHASH_PRECISION).toBe(12);
  });
});

describe("geohash", () => {
  // The example of geohash.org and of the Wikipedia article "Geohash": 57.64911, 10.40744 is u4pruydqqvj.
  it("gives the geohash.org value", () => {
    expect(geohash({ lat: 57.64911, lon: 10.40744 }, 11)).toBe("u4pruydqqvj");
  });

  // The vectors of the tests of @procedures/geo.
  it("gives the values of @procedures/geo", () => {
    expect(geohash(EIFFEL)).toBe("u09tunq");
    expect(geohash(OPERA)).toBe("r3gx2ux");
    expect(geohash(OPERA, 9)).toBe("r3gx2ux9g");
    expect(geohash(LIBERTY)).toBe("dr5r7p4");
    expect(geohash(LIBERTY, 12)).toBe("dr5r7p4ry0eh");
    expect(geohash(LIBERTY, 5)).toBe("dr5r7");
    expect(geohash(LIBERTY, 1)).toBe("d");
  });

  it("puts a point on an edge in the cell on the north or the east", () => {
    expect(geohash({ lat: 0, lon: 0 })).toBe("s000000");
    expect(geohash({ lat: 0, lon: -180 })).toBe("8000000");
    expect(geohash({ lat: -45, lon: 90 })).toBe("q000000");
    expect(geohash({ lat: 90, lon: 180 })).toBe("zzzzzzz");
    expect(geohash({ lat: -90, lon: -180 })).toBe("0000000");
  });

  it("normalizes a longitude out of the range", () => {
    expect(geohash({ lat: 48.8584, lon: 362.2945 })).toBe(geohash({ lat: 48.8584, lon: 2.2945 }));
    expect(geohash({ lat: 0, lon: -190 })).toBe(geohash({ lat: 0, lon: 170 }));
  });

  it("refuses an incorrect point or precision", () => {
    expect(codeOf(() => geohash({ lat: 91, lon: 0 }))).toBe("latitude-range");
    expect(codeOf(() => geohash({ lat: Number.NaN, lon: 0 }))).toBe("not-finite");
    expect(codeOf(() => geohash({ lat: 0, lon: Number.POSITIVE_INFINITY }))).toBe("not-finite");
    expect(codeOf(() => geohash(EIFFEL, 0))).toBe("geohash-precision");
    expect(codeOf(() => geohash(EIFFEL, 13))).toBe("geohash-precision");
    expect(codeOf(() => geohash(EIFFEL, 2.5))).toBe("geohash-precision");
  });
});

describe("decodeGeohash", () => {
  it("gives the cell of one character", () => {
    expect(decodeGeohash("s")).toEqual({ south: 0, west: 0, north: 45, east: 45, center: { lat: 22.5, lon: 22.5 } });
  });

  // The Wikipedia article "Geohash": ezs42 is the cell of 42.605, -5.603.
  it("gives the Wikipedia value of ezs42", () => {
    const cell = decodeGeohash("ezs42");
    expect(cell.center.lat).toBeCloseTo(42.605, 3);
    expect(cell.center.lon).toBeCloseTo(-5.603, 3);
    expect(cell).toEqual({
      south: 42.5830078125,
      west: -5.625,
      north: 42.626953125,
      east: -5.5810546875,
      center: { lat: 42.60498046875, lon: -5.60302734375 },
    });
  });

  it("accepts upper case letters", () => {
    expect(decodeGeohash("U09TUNQ")).toEqual(decodeGeohash("u09tunq"));
  });

  it("refuses a character that is not in the alphabet, as a RangeError", () => {
    expect(() => decodeGeohash("u09a")).toThrow(/"a"/);
    expect(() => decodeGeohash("u09a")).toThrow(RangeError);
    expect(codeOf(() => decodeGeohash("u09a"))).toBe("geohash-character");
  });

  it("refuses an empty geohash and a geohash longer than 12", () => {
    expect(() => decodeGeohash("")).toThrow(RangeError);
    expect(codeOf(() => decodeGeohash(""))).toBe("geohash-length");
    expect(codeOf(() => decodeGeohash("0123456789bcd"))).toBe("geohash-length");
  });
});

describe("geohashNeighbor", () => {
  // The README of the npm package ngeohash: the neighbors of dqcjq.
  it("gives the ngeohash values of the neighbors of dqcjq", () => {
    expect(geohashNeighbors("dqcjq")).toEqual({
      n: "dqcjw",
      ne: "dqcjx",
      e: "dqcjr",
      se: "dqcjp",
      s: "dqcjn",
      sw: "dqcjj",
      w: "dqcjm",
      nw: "dqcjt",
    });
  });

  it("wraps at the antimeridian", () => {
    expect(geohashNeighbor("8", "w")).toBe("x");
    expect(geohashNeighbor("x", "e")).toBe("8");
    expect(geohashNeighbor("zzzz", "e")).toBe(geohash({ lat: 89.99, lon: -179.99 }, 4));
  });

  it("is undefined past a pole", () => {
    expect(geohashNeighbor("zzzz", "n")).toBeUndefined();
    expect(geohashNeighbor("0000", "s")).toBeUndefined();
    expect(geohashNeighbors("zzzz").ne).toBeUndefined();
    expect(geohashNeighbors("zzzz").s).toBeDefined();
  });

  it("gives lower case letters with the same precision", () => {
    expect(geohashNeighbor("DQCJQ", "n")).toBe("dqcjw");
  });

  it("refuses an incorrect geohash", () => {
    expect(codeOf(() => geohashNeighbor("", "n"))).toBe("geohash-length");
    expect(codeOf(() => geohashNeighbors("dqcja"))).toBe("geohash-character");
  });
});

describe("geohashesInBBox", () => {
  it("covers a box with the cells of one precision", () => {
    expect(geohashesInBBox({ west: 0, south: 0, east: 44, north: 44 }, 1)).toEqual(["s"]);
    expect(geohashesInBBox({ west: -10, south: -10, east: 10, north: 10 }, 1)).toEqual(["7", "k", "e", "s"]);
  });

  it("takes the cell of a point on an edge with the rule of geohash", () => {
    // The east edge of the box is the west edge of the next cell, so that cell has a point of the box.
    expect(geohashesInBBox({ west: 0, south: 0, east: 45, north: 44 }, 1)).toEqual(["s", "t"]);
    // The west edge of the box is the east edge of the cell 7, but the point goes to the cell s.
    expect(geohashesInBBox({ west: 0, south: 0, east: 44, north: 44 }, 1)).not.toContain("7");
  });

  it("covers a box that crosses the antimeridian", () => {
    expect(geohashesInBBox({ west: 170, south: -10, east: -170, north: 10 }, 1)).toEqual(["r", "2", "x", "8"]);
  });

  it("covers the full Earth", () => {
    expect(geohashesInBBox({ west: -180, south: -90, east: 180, north: 90 }, 1)).toHaveLength(32);
  });

  it("refuses a cover with too many cells", () => {
    expect(codeOf(() => geohashesInBBox({ west: -180, south: -90, east: 180, north: 90 }, 2, 100))).toBe("too-many-cells");
    expect(codeOf(() => geohashesInBBox({ west: 0, south: 0, east: 1, north: 1 }, 1, Number.NaN))).toBe("too-many-cells");
    expect(codeOf(() => geohashesInBBox({ west: 0, south: 0, east: 1, north: 1 }, 1, -1))).toBe("too-many-cells");
    expect(geohashesInBBox({ west: -180, south: -90, east: 180, north: 90 }, 2, 1024)).toHaveLength(1024);
  });

  it("refuses an incorrect box or precision", () => {
    expect(codeOf(() => geohashesInBBox({ west: 0, south: 5, east: 1, north: 1 }, 1))).toBe("bbox");
    expect(codeOf(() => geohashesInBBox({ west: 0, south: 0, east: 1, north: 1 }, 0))).toBe("geohash-precision");
  });
});
