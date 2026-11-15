import { describe, expect, it } from "vitest";
import {
  GeoError,
  followsRightHandRule,
  locatePoint,
  MAX_GEOMETRY_LONGITUDE,
  polygonIntersectsBBox,
  polygonsIntersect,
  rewind,
  ringWinding,
  type MultiPolygon,
  type Polygon,
  type Position,
} from "./index.ts";

const square = (west: number, south: number, east: number, north: number): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

// RFC 7946, appendix A: a polygon with a hole. The exterior is counterclockwise and the hole is clockwise.
const WITH_HOLE: Polygon = {
  type: "Polygon",
  coordinates: [
    [[100.0, 0.0], [101.0, 0.0], [101.0, 1.0], [100.0, 1.0], [100.0, 0.0]],
    [[100.8, 0.8], [100.8, 0.2], [100.2, 0.2], [100.2, 0.8], [100.8, 0.8]],
  ],
};

// RFC 7946, section 3.1.9: a polygon from 170 E to 170 W, cut at the antimeridian into two polygons.
const CUT: MultiPolygon = {
  type: "MultiPolygon",
  coordinates: [
    [[[180.0, 40.0], [180.0, 50.0], [170.0, 50.0], [170.0, 40.0], [180.0, 40.0]]],
    [[[-170.0, 40.0], [-170.0, 50.0], [-180.0, 50.0], [-180.0, 40.0], [-170.0, 40.0]]],
  ],
};

// The same area, not cut: its longitudes go past 180.
const PAST_180: Polygon = square(170, 40, 190, 50);

// A triangle written past 180. Its inside is 350 < x < 350 + y, from y = 0 to y = 20.
const FAR_TRIANGLE: Polygon = { type: "Polygon", coordinates: [[[350, 0], [370, 20], [350, 20], [350, 0]]] };

// A latitude with fine bits. The point (EDGE_LAT - 10, EDGE_LAT) moved by 360 is exactly on the edge x = 350 + y of
// FAR_TRIANGLE, but the floating-point sum EDGE_LAT - 10 + 360 rounds to the east of the edge.
const EDGE_LAT = 5 + 3 * 2 ** -46;

// A polar cap in the form of RFC 7946, section 5.3: the full range of longitudes up to the pole.
const CAP: Polygon = {
  type: "Polygon",
  coordinates: [[[-180, 80], [180, 80], [180, 90], [-180, 90], [-180, 80]]],
};

describe("locatePoint", () => {
  it("finds the inside, the hole and the outside of the RFC 7946 polygon", () => {
    expect(locatePoint({ lat: 0.1, lon: 100.1 }, WITH_HOLE)).toBe("inside");
    expect(locatePoint({ lat: 0.5, lon: 100.5 }, WITH_HOLE)).toBe("outside");
    expect(locatePoint({ lat: 2, lon: 100.5 }, WITH_HOLE)).toBe("outside");
    expect(locatePoint({ lat: 0.5, lon: 99 }, WITH_HOLE)).toBe("outside");
  });

  it("puts a point on an edge or a vertex on the boundary", () => {
    expect(locatePoint({ lat: 0, lon: 100.5 }, WITH_HOLE)).toBe("boundary");
    expect(locatePoint({ lat: 0, lon: 100 }, WITH_HOLE)).toBe("boundary");
    expect(locatePoint({ lat: 1, lon: 101 }, WITH_HOLE)).toBe("boundary");
    // The edge of the hole is also on the boundary of the polygon.
    expect(locatePoint({ lat: 0.2, lon: 100.5 }, WITH_HOLE)).toBe("boundary");
    expect(locatePoint({ lat: 0.8, lon: 100.8 }, WITH_HOLE)).toBe("boundary");
  });

  it("finds a point on a diagonal edge exactly", () => {
    const triangle: Polygon = { type: "Polygon", coordinates: [[[0, 0], [3, 0], [0, 3], [0, 0]]] };
    expect(locatePoint({ lat: 1.5, lon: 1.5 }, triangle)).toBe("boundary");
    expect(locatePoint({ lat: 1.5, lon: 1.4999999999999998 }, triangle)).toBe("inside");
    expect(locatePoint({ lat: 1.5, lon: 1.5000000000000002 }, triangle)).toBe("outside");
  });

  it("gives the same result for a ring with the right-hand rule and against it", () => {
    const clockwise: Polygon = { type: "Polygon", coordinates: [[...(square(0, 0, 2, 2).coordinates[0] as Position[])].reverse()] };
    for (const point of [{ lat: 1, lon: 1 }, { lat: 0, lon: 1 }, { lat: 3, lon: 1 }]) {
      expect(locatePoint(point, clockwise)).toBe(locatePoint(point, square(0, 0, 2, 2)));
    }
  });

  it("works on the two sides of a polygon cut at the antimeridian", () => {
    expect(locatePoint({ lat: 45, lon: 175 }, CUT)).toBe("inside");
    expect(locatePoint({ lat: 45, lon: -175 }, CUT)).toBe("inside");
    expect(locatePoint({ lat: 45, lon: 0 }, CUT)).toBe("outside");
    expect(locatePoint({ lat: 45, lon: 165 }, CUT)).toBe("outside");
    // The cut is an edge of each part.
    expect(locatePoint({ lat: 45, lon: 180 }, CUT)).toBe("boundary");
    expect(locatePoint({ lat: 45, lon: -180 }, CUT)).toBe("boundary");
    expect(locatePoint({ lat: 45, lon: 180 }, CUT)).not.toBe("outside");
  });

  it("works on a polygon with longitudes past 180", () => {
    expect(locatePoint({ lat: 45, lon: 175 }, PAST_180)).toBe("inside");
    expect(locatePoint({ lat: 45, lon: -175 }, PAST_180)).toBe("inside");
    expect(locatePoint({ lat: 45, lon: 185 }, PAST_180)).toBe("inside");
    expect(locatePoint({ lat: 45, lon: 180 }, PAST_180)).toBe("inside");
    expect(locatePoint({ lat: 45, lon: -170 }, PAST_180)).toBe("boundary");
    expect(locatePoint({ lat: 45, lon: -160 }, PAST_180)).toBe("outside");
  });

  it("puts the pole on the boundary of a polygon that has a position at the pole", () => {
    // Each longitude of the pole is the same point.
    expect(locatePoint({ lat: 90, lon: 0 }, CAP)).toBe("boundary");
    expect(locatePoint({ lat: 90, lon: 123 }, CAP)).toBe("boundary");
    expect(locatePoint({ lat: 85, lon: 123 }, CAP)).toBe("inside");
    expect(locatePoint({ lat: 75, lon: 123 }, CAP)).toBe("outside");
    expect(locatePoint({ lat: 90, lon: -45 }, CAP)).not.toBe("outside");
    // A triangle with one vertex at the pole has the pole for each longitude.
    const spike: Polygon = { type: "Polygon", coordinates: [[[0, 80], [20, 80], [10, 90], [0, 80]]] };
    expect(locatePoint({ lat: 90, lon: -100 }, spike)).toBe("boundary");
    expect(locatePoint({ lat: -90, lon: 10 }, spike)).toBe("outside");
  });

  it("puts the pole outside a polygon with no position at the pole", () => {
    // A ring at latitude 80 is not a polar cap: each edge is a straight line in longitude and latitude.
    const ring: Polygon = { type: "Polygon", coordinates: [[[0, 80], [90, 80], [90, 85], [0, 85], [0, 80]]] };
    expect(locatePoint({ lat: 90, lon: 45 }, ring)).toBe("outside");
    const south: Polygon = { type: "Polygon", coordinates: [[[-180, -90], [180, -90], [180, -60], [-180, -60], [-180, -90]]] };
    expect(locatePoint({ lat: -90, lon: 77 }, south)).toBe("boundary");
  });

  it("gives the boundary of the written form at a seam, and the same containment for each form", () => {
    // Two parts that share an edge, and the same area as one part.
    const halves: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [square(0, 0, 1, 1).coordinates, square(1, 0, 2, 1).coordinates],
    };
    expect(locatePoint({ lat: 0.5, lon: 1 }, halves)).toBe("boundary");
    expect(locatePoint({ lat: 0.5, lon: 1 }, square(0, 0, 2, 1))).toBe("inside");
    // The cut at the antimeridian, and the same area written past 180.
    expect(locatePoint({ lat: 45, lon: 180 }, CUT)).toBe("boundary");
    expect(locatePoint({ lat: 45, lon: 180 }, PAST_180)).toBe("inside");
    for (const point of [{ lat: 0.5, lon: 1 }, { lat: 0.5, lon: 3 }]) {
      expect(locatePoint(point, halves) !== "outside").toBe(locatePoint(point, square(0, 0, 2, 1)) !== "outside");
    }
  });

  it("is exact for a point that is not near the polygon before the move by 360", () => {
    // The exact sum -9.9 + 360 is west of the edge x = 350 + 0.1. The floating-point sum is on the edge.
    expect(-9.9 + 360).toBe(350 + 0.1);
    expect(locatePoint({ lat: 0.1, lon: -9.9 }, FAR_TRIANGLE)).toBe("inside");
    // The point is exactly on the edge after the move: the edge is at 355 + 3 * 2^-46 for this latitude. The
    // floating-point sum is 355 + 2^-44, east of the edge.
    expect(EDGE_LAT - 5).toBe(3 * 2 ** -46);
    expect(EDGE_LAT - 10 + 360).toBe(355 + 2 ** -44);
    expect(locatePoint({ lat: EDGE_LAT, lon: EDGE_LAT - 10 }, FAR_TRIANGLE)).toBe("boundary");
    // The same areas written near 0 give the same results.
    const near: Polygon = { type: "Polygon", coordinates: [[[-10, 0], [10, 20], [-10, 20], [-10, 0]]] };
    expect(locatePoint({ lat: 0.1, lon: -9.9 }, near)).toBe("inside");
    expect(locatePoint({ lat: EDGE_LAT, lon: EDGE_LAT - 10 }, near)).toBe("boundary");
  });

  it("is exact for a point written past 180 with fine bits", () => {
    // 400 + 2^-44 - 360 has no rounding. Each vertex is on the boundary.
    const x = 400 + 2 ** -44;
    const fine: Polygon = { type: "Polygon", coordinates: [[[x, 1], [x + 1, 1], [x, 2], [x, 1]]] };
    expect(locatePoint({ lat: 1, lon: x }, fine)).toBe("boundary");
    expect(locatePoint({ lat: 2, lon: x }, fine)).toBe("boundary");
    expect(locatePoint({ lat: 1.5, lon: x - 2 ** -44 }, fine)).toBe("outside");
  });

  it("is inside when a point is on the boundary of one part and inside another part", () => {
    const parts: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [square(0, 0, 2, 2).coordinates, square(-1, -1, 3, 3).coordinates],
    };
    expect(locatePoint({ lat: 0, lon: 1 }, parts)).toBe("inside");
  });

  it("refuses an unclosed ring and a ring with fewer than four positions", () => {
    const open = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } as Polygon;
    expect(() => locatePoint({ lat: 0.5, lon: 0.5 }, open)).toThrow(GeoError);
    const short = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] } as Polygon;
    expect(() => locatePoint({ lat: 0.5, lon: 0.5 }, short)).toThrow(GeoError);
    const badParts = { type: "MultiPolygon", coordinates: "none" } as unknown as MultiPolygon;
    expect(() => locatePoint({ lat: 0.5, lon: 0.5 }, badParts)).toThrow(GeoError);
  });

  it("refuses a geometry that is not a polygon and an incorrect point", () => {
    expect(() => locatePoint({ lat: 0, lon: 0 }, { type: "Point", coordinates: [0, 0] } as unknown as Polygon)).toThrow(GeoError);
    expect(() => locatePoint({ lat: Number.NaN, lon: 0 }, WITH_HOLE)).toThrow(GeoError);
  });

  it("is outside an empty polygon", () => {
    expect(locatePoint({ lat: 0, lon: 0 }, { type: "Polygon", coordinates: [] })).toBe("outside");
    expect(locatePoint({ lat: 0, lon: 0 }, { type: "MultiPolygon", coordinates: [] })).toBe("outside");
  });
});

describe("ringWinding", () => {
  it("gives the winding of the RFC 7946 rings", () => {
    expect(ringWinding(WITH_HOLE.coordinates[0] as Position[])).toBe("counterclockwise");
    expect(ringWinding(WITH_HOLE.coordinates[1] as Position[])).toBe("clockwise");
  });

  it("finds a degenerate ring", () => {
    expect(ringWinding([[0, 0], [1, 1], [2, 2], [0, 0]])).toBe("degenerate");
  });

  it("is exact for a thin ring and for large coordinates", () => {
    // Three points that are almost on one line. The area is 2^-53.
    const e = 2 ** -52;
    expect(ringWinding([[0, 0], [1, 1], [1, 1 + e], [0, 0]])).toBe("counterclockwise");
    expect(ringWinding([[0, 0], [1, 1 + e], [1, 1], [0, 0]])).toBe("clockwise");
    // The products are near 9e17, where the spacing of floats is 128, so a float sum cannot give the area of 1.
    expect(ringWinding([[1e16, 89], [1e16 + 2, 89], [1e16 + 2, 90], [1e16, 89]])).toBe("counterclockwise");
    expect(ringWinding([[1e16, 88], [1e16 + 2, 89], [1e16 + 4, 90], [1e16, 88]])).toBe("degenerate");
  });

  it("refuses an unclosed ring", () => {
    expect(() => ringWinding([[0, 0], [1, 0], [1, 1], [0, 1]])).toThrow(GeoError);
  });
});

describe("the right-hand rule", () => {
  it("is followed by the RFC 7946 polygon", () => {
    expect(followsRightHandRule(WITH_HOLE)).toBe(true);
    expect(followsRightHandRule({ type: "MultiPolygon", coordinates: [WITH_HOLE.coordinates] })).toBe(true);
  });

  it("is not followed when a ring is the other way", () => {
    const reversed: Polygon = {
      type: "Polygon",
      coordinates: WITH_HOLE.coordinates.map((ring) => [...ring].reverse()),
    };
    expect(followsRightHandRule(reversed)).toBe(false);
    expect(followsRightHandRule(rewind(reversed))).toBe(true);
    expect(rewind(reversed).coordinates).toEqual(WITH_HOLE.coordinates);
  });

  it("is applied by rewind to each part and keeps the other members", () => {
    const parts = {
      type: "MultiPolygon",
      coordinates: [[[...(square(0, 0, 1, 1).coordinates[0] as Position[])].reverse()]],
      title: "a foreign member",
    } as MultiPolygon & { readonly title: string };
    const fixed = rewind(parts);
    expect(followsRightHandRule(fixed)).toBe(true);
    expect(fixed.title).toBe("a foreign member");
    expect(parts.coordinates[0]?.[0]?.[1]).toEqual([0, 1]);
  });

  it("does not change a degenerate ring", () => {
    const flat: Polygon = { type: "Polygon", coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]] };
    expect(rewind(flat).coordinates).toEqual(flat.coordinates);
    expect(followsRightHandRule(flat)).toBe(false);
  });

  it("refuses a geometry that is not a polygon", () => {
    const point = { type: "Point", coordinates: [0, 0] } as unknown as Polygon;
    expect(() => rewind(point)).toThrow(GeoError);
    expect(() => followsRightHandRule(point)).toThrow(GeoError);
  });
});

describe("polygonsIntersect", () => {
  it("finds an overlap, a touch at an edge and a touch at a vertex", () => {
    expect(polygonsIntersect(square(0, 0, 2, 2), square(1, 1, 3, 3))).toBe(true);
    expect(polygonsIntersect(square(0, 0, 2, 2), square(2, 0, 4, 2))).toBe(true);
    expect(polygonsIntersect(square(0, 0, 2, 2), square(2, 2, 4, 4))).toBe(true);
    expect(polygonsIntersect(square(0, 0, 2, 2), square(3, 0, 4, 2))).toBe(false);
  });

  it("finds a polygon fully inside the other", () => {
    expect(polygonsIntersect(square(0, 0, 10, 10), square(4, 4, 5, 5))).toBe(true);
    expect(polygonsIntersect(square(4, 4, 5, 5), square(0, 0, 10, 10))).toBe(true);
  });

  it("does not find a polygon in a hole", () => {
    const inHole = square(100.4, 0.4, 100.6, 0.6);
    expect(polygonsIntersect(WITH_HOLE, inHole)).toBe(false);
    expect(polygonsIntersect(inHole, WITH_HOLE)).toBe(false);
    // A polygon that touches the edge of the hole intersects.
    expect(polygonsIntersect(WITH_HOLE, square(100.4, 0.4, 100.8, 0.6))).toBe(true);
  });

  it("finds two polygons that cross with no vertex inside the other", () => {
    const wide = square(0, 1, 4, 2);
    const tall = square(1, 0, 2, 4);
    expect(polygonsIntersect(wide, tall)).toBe(true);
  });

  it("works across the antimeridian", () => {
    expect(polygonsIntersect(CUT, square(-175, 44, -172, 46))).toBe(true);
    expect(polygonsIntersect(PAST_180, square(-175, 44, -172, 46))).toBe(true);
    expect(polygonsIntersect(square(-175, 44, -172, 46), PAST_180)).toBe(true);
    expect(polygonsIntersect(PAST_180, square(-160, 44, -150, 46))).toBe(false);
    expect(polygonsIntersect(PAST_180, square(0, 44, 10, 46))).toBe(false);
  });

  it("finds two polygons that touch at one point after the move by 360, in the two orders", () => {
    // The vertex P of the small triangle is exactly on the edge x = 350 + y of FAR_TRIANGLE after the move. Its other
    // vertices are east of that edge. So the two closed polygons have only the point P in common.
    const px = EDGE_LAT - 10;
    const touching: Polygon = {
      type: "Polygon",
      coordinates: [[[px, EDGE_LAT], [px + 2, EDGE_LAT], [px + 2, EDGE_LAT + 1], [px, EDGE_LAT]]],
    };
    expect(polygonsIntersect(FAR_TRIANGLE, touching)).toBe(true);
    expect(polygonsIntersect(touching, FAR_TRIANGLE)).toBe(true);
    // A move of the small triangle by 2^-44 to the east removes the common point.
    const apart: Polygon = {
      type: "Polygon",
      coordinates: [[[px + 2 ** -44, EDGE_LAT], [px + 2, EDGE_LAT], [px + 2, EDGE_LAT + 1], [px + 2 ** -44, EDGE_LAT]]],
    };
    expect(polygonsIntersect(FAR_TRIANGLE, apart)).toBe(false);
    expect(polygonsIntersect(apart, FAR_TRIANGLE)).toBe(false);
  });

  it("gives the same result in the two orders when no move is exact", () => {
    // The polygon a has longitudes on the two sides of 0, and b has the longitude 100. A move by 360 is exact for a
    // longitude of 128 or more against its sign, so no rule proves an exact move of a or of b.
    const a: Polygon = { type: "Polygon", coordinates: [[[-1, 0], [1, 0], [0, 1], [-1, 0]]] };
    const b: Polygon = { type: "Polygon", coordinates: [[[100, 0.5], [361, 0.5], [360, 2], [100, 0.5]]] };
    const c: Polygon = { type: "Polygon", coordinates: [[[100, 5], [361, 5], [360, 6], [100, 5]]] };
    expect(polygonsIntersect(a, b)).toBe(true);
    expect(polygonsIntersect(b, a)).toBe(true);
    expect(polygonsIntersect(a, c)).toBe(false);
    expect(polygonsIntersect(c, a)).toBe(false);
  });

  it("finds two polygons that meet at a pole", () => {
    const a: Polygon = { type: "Polygon", coordinates: [[[0, 80], [20, 80], [10, 90], [0, 80]]] };
    const b: Polygon = { type: "Polygon", coordinates: [[[100, 80], [120, 80], [110, 90], [100, 80]]] };
    expect(polygonsIntersect(a, b)).toBe(true);
    expect(polygonsIntersect(a, square(100, 80, 120, 85))).toBe(false);
  });

  it("does not find polygons with no common latitude", () => {
    expect(polygonsIntersect(square(0, 0, 1, 1), square(0, 5, 1, 6))).toBe(false);
  });
});

describe("polygonIntersectsBBox", () => {
  it("finds a box that overlaps, touches or misses a polygon", () => {
    expect(polygonIntersectsBBox(WITH_HOLE, { west: 100.5, south: 0.5, east: 102, north: 2 })).toBe(true);
    expect(polygonIntersectsBBox(WITH_HOLE, { west: 101, south: 1, east: 102, north: 2 })).toBe(true);
    expect(polygonIntersectsBBox(WITH_HOLE, { west: 101.1, south: 1, east: 102, north: 2 })).toBe(false);
    expect(polygonIntersectsBBox(WITH_HOLE, { west: 100.4, south: 0.4, east: 100.6, north: 0.6 })).toBe(false);
  });

  it("works with a box that crosses the antimeridian", () => {
    const fiji = { west: 177, south: -20, east: -178, north: -16 };
    expect(polygonIntersectsBBox(square(-179, -19, -178.5, -18), fiji)).toBe(true);
    expect(polygonIntersectsBBox(square(178, -19, 179, -18), fiji)).toBe(true);
    expect(polygonIntersectsBBox(square(0, -19, 1, -18), fiji)).toBe(false);
  });

  it("works with a degenerate box", () => {
    expect(polygonIntersectsBBox(WITH_HOLE, { west: 100.1, south: 0.1, east: 100.1, north: 0.1 })).toBe(true);
    expect(polygonIntersectsBBox(WITH_HOLE, { west: 100.5, south: 0.5, east: 100.5, north: 0.5 })).toBe(false);
  });

  it("finds the pole in a box that reaches it", () => {
    const spike: Polygon = { type: "Polygon", coordinates: [[[0, 80], [20, 80], [10, 90], [0, 80]]] };
    expect(polygonIntersectsBBox(spike, { west: 100, south: 89, east: 110, north: 90 })).toBe(true);
    expect(polygonIntersectsBBox(spike, { west: 100, south: 85, east: 110, north: 89 })).toBe(false);
  });

  it("refuses an incorrect box", () => {
    expect(() => polygonIntersectsBBox(WITH_HOLE, { west: 0, south: 2, east: 1, north: 1 })).toThrow(GeoError);
  });
});

describe("the longitude limit of the polygon tests", () => {
  // A ring that goes around the Earth about 5.5 billion times. Before 0.2.0, locatePoint ran for more than 20 s on it.
  const WIDE: Polygon = { type: "Polygon", coordinates: [[[-1e12, 0], [1e12, 0], [1e12, 1], [-1e12, 0]]] };

  const codeOf = (run: () => unknown): { code: string; path: string } => {
    try {
      run();
    } catch (error) {
      if (error instanceof GeoError) return { code: error.code, path: error.path };
      throw error;
    }
    throw new Error("The function did not throw");
  };

  it("refuses a longitude past 540 at once, with its path", () => {
    expect(MAX_GEOMETRY_LONGITUDE).toBe(540);
    const started = performance.now();
    expect(codeOf(() => locatePoint({ lat: 0.5, lon: 10 }, WIDE))).toEqual({
      code: "longitude-range",
      path: "coordinates[0][0]",
    });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(codeOf(() => polygonsIntersect(square(0, 0, 1, 1), WIDE)).code).toBe("longitude-range");
    expect(codeOf(() => polygonIntersectsBBox(WIDE, { west: 0, south: 0, east: 1, north: 1 })).code).toBe("longitude-range");
  });

  it("gives the path of the position in a MultiPolygon", () => {
    const multi: MultiPolygon = { type: "MultiPolygon", coordinates: [square(0, 0, 1, 1).coordinates, square(540, 0, 540.5, 1).coordinates] };
    expect(codeOf(() => locatePoint({ lat: 0.5, lon: 0.5 }, multi))).toEqual({
      code: "longitude-range",
      path: "coordinates[1][0][1]",
    });
  });

  it("accepts each longitude from -540 to 540", () => {
    expect(locatePoint({ lat: 0.5, lon: 179.5 }, square(539, 0, 540, 1))).toBe("inside");
    expect(locatePoint({ lat: 0.5, lon: -179.5 }, square(-540, 0, -539, 1))).toBe("inside");
    expect(locatePoint({ lat: 0.5, lon: 0.5 }, square(-540, 0, 540, 1))).toBe("inside");
  });
});
