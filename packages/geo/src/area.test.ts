import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import { areaSquareMeters, commonAreaSquareMeters, overlapAreaSquareMeters } from "./area.ts";
import { GeoError } from "./errors.ts";
import { WGS84, type Ellipsoid } from "./geodesic.ts";
import type { MultiPolygon, Polygon } from "./geojson.ts";
import type { Position } from "./point.ts";

const DEGREE = Math.PI / 180;
const SPHERE: Ellipsoid = { equatorialRadiusMeters: 6_371_000, flattening: 0 };
const E2 = WGS84.flattening * (2 - WGS84.flattening);
const A = WGS84.equatorialRadiusMeters;

const polygon = (...rings: Position[][]): Polygon => ({ type: "Polygon", coordinates: rings.map((ring) => [...ring, ring[0]!]) });
const box = (west: number, south: number, east: number, north: number): Position[] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
];
const reversed = (ring: Position[]): Position[] => [...ring].reverse();

/** The area element of WGS84 for one degree of latitude and one degree of longitude at the latitude `lat`, by M N cos. */
function element(lat: number, e2: number = E2, a: number = A): number {
  const s = Math.sin(lat * DEGREE);
  const w = 1 - e2 * s * s;
  const m = (a * (1 - e2)) / w ** 1.5;
  const n = a / Math.sqrt(w);
  return m * n * Math.cos(lat * DEGREE) * DEGREE * DEGREE;
}

/** The integral of `f` from `a` to `b` by the rule of Simpson with `steps` steps, an independent reference. */
function simpson(f: (x: number) => number, a: number, b: number, steps = 2000): number {
  const h = (b - a) / steps;
  let sum = f(a) + f(b);
  for (let i = 1; i < steps; i += 1) sum += f(a + i * h) * (i % 2 === 1 ? 4 : 2);
  return (sum * h) / 3;
}

const relative = (actual: number, expected: number): number => Math.abs(actual - expected) / Math.abs(expected);

describe("areaSquareMeters", () => {
  it("gives the area of the whole ellipsoid", () => {
    // The closed form of the area of an oblate ellipsoid: 2 pi a^2 + pi b^2 / e ln((1 + e) / (1 - e)).
    const e = Math.sqrt(E2);
    const b2 = A * A * (1 - E2);
    const expected = 2 * Math.PI * A * A + ((Math.PI * b2) / e) * Math.log((1 + e) / (1 - e));
    expect(relative(areaSquareMeters(polygon(box(-180, -90, 180, 90))), expected)).toBeLessThan(1e-14);
    expect(expected / 1e6).toBeCloseTo(510_065_621.724, 2);
  });

  it("gives the area of a zone of a sphere", () => {
    const expected = SPHERE.equatorialRadiusMeters ** 2 * (Math.sin(20 * DEGREE) - Math.sin(10 * DEGREE)) * 30 * DEGREE;
    expect(relative(areaSquareMeters(polygon(box(0, 10, 30, 20)), SPHERE), expected)).toBeLessThan(1e-14);
  });

  it("agrees with an independent integral for a cell and for a long sloped edge", () => {
    expect(relative(areaSquareMeters(polygon(box(0, 0, 1, 1))), simpson(element, 0, 1))).toBeLessThan(1e-12);
    // The triangle under the line lat = 4 lon from lon 0 to lon 10: the edge crosses 40 degrees of latitude.
    const expected = simpson((lon) => simpson(element, 0, 4 * lon, 400), 0, 10, 400);
    expect(relative(areaSquareMeters(polygon([[0, 0], [10, 0], [10, 40]])), expected)).toBeLessThan(1e-9);
  });

  it("gives the area on a prolate ellipsoid, with a flattening less than 0", () => {
    const prolate: Ellipsoid = { equatorialRadiusMeters: 6_378_137, flattening: -1 / 300 };
    const e2 = prolate.flattening * (2 - prolate.flattening);
    const expected = simpson((lat) => element(lat, e2, prolate.equatorialRadiusMeters), 10, 30);
    expect(relative(areaSquareMeters(polygon(box(0, 10, 1, 30)), prolate), expected)).toBeLessThan(1e-11);
  });

  it("gives the same area for both directions of a ring, and takes the holes away", () => {
    const outer = box(-71.01, 44, -71, 44.01);
    const hole = box(-71.008, 44.002, -71.004, 44.006);
    expect(areaSquareMeters(polygon(reversed(outer)))).toBe(areaSquareMeters(polygon(outer)));
    const holed = areaSquareMeters(polygon(outer, hole));
    expect(relative(holed, areaSquareMeters(polygon(outer)) - areaSquareMeters(polygon(hole)))).toBeLessThan(1e-12);
    // A square of 0.01 degree at 44 degrees north is about 801 m by 1112 m.
    expect(areaSquareMeters(polygon(outer)) / 1e6).toBeCloseTo(0.891, 2);
  });

  it("adds the polygons of a MultiPolygon, and gives 0 for a ring with no area", () => {
    const multi: MultiPolygon = { type: "MultiPolygon", coordinates: [polygon(box(0, 0, 1, 1)).coordinates, polygon(box(2, 0, 3, 1)).coordinates] };
    expect(relative(areaSquareMeters(multi), 2 * areaSquareMeters(polygon(box(0, 0, 1, 1))))).toBeLessThan(1e-14);
    expect(areaSquareMeters(polygon([[0, 0], [1, 1], [2, 2]]))).toBe(0);
  });

  it("refuses a geometry that is not a polygon and an ellipsoid that is not valid", () => {
    expect(() => areaSquareMeters({ type: "Point", coordinates: [0, 0] } as unknown as Polygon)).toThrow(GeoError);
    expect(() => areaSquareMeters(polygon(box(0, 0, 1, 1)), { equatorialRadiusMeters: -1, flattening: 0 })).toThrow(GeoError);
  });
});

describe("overlapAreaSquareMeters", () => {
  const square = box(-71.01, 44, -71, 44.01);
  const area = (ring: Position[], ...holes: Position[][]) => areaSquareMeters(polygon(ring, ...holes));

  it("gives the area of the common box of two boxes", () => {
    const shifted = box(-71.005, 44.005, -70.995, 44.015);
    const common = area(box(-71.005, 44.005, -71, 44.01));
    expect(relative(overlapAreaSquareMeters(polygon(square), polygon(shifted)), common)).toBeLessThan(1e-9);
    expect(relative(overlapAreaSquareMeters(polygon(reversed(square)), polygon(shifted)), common)).toBeLessThan(1e-9);
  });

  it("gives 0 for polygons apart or with a common edge, and the smaller area for a polygon inside another", () => {
    expect(overlapAreaSquareMeters(polygon(square), polygon(box(-70.99, 44, -70.98, 44.01)))).toBe(0);
    expect(overlapAreaSquareMeters(polygon(square), polygon(box(-71, 44, -70.99, 44.01)))).toBeLessThan(1e-6);
    const inner = box(-71.008, 44.002, -71.004, 44.006);
    expect(relative(overlapAreaSquareMeters(polygon(square), polygon(inner)), area(inner))).toBeLessThan(1e-9);
    expect(relative(overlapAreaSquareMeters(polygon(square), polygon(square)), area(square))).toBeLessThan(1e-9);
  });

  it("takes the holes and the concave corners into the overlap", () => {
    // An L shape: the square less its north-east quarter.
    const l: Position[] = [[-71.01, 44], [-71, 44], [-71, 44.005], [-71.005, 44.005], [-71.005, 44.01], [-71.01, 44.01]];
    const east = box(-71.006, 44, -70.99, 44.01);
    const expected = area(box(-71.005, 44, -71, 44.005)) + area(box(-71.006, 44, -71.005, 44.01));
    expect(relative(overlapAreaSquareMeters(polygon(l), polygon(east)), expected)).toBeLessThan(1e-9);
    const hole = box(-71.008, 44.002, -71.004, 44.006);
    const west = box(-71.02, 43.99, -71.006, 44.02);
    const withHole = area(box(-71.01, 44, -71.006, 44.01)) - area(box(-71.008, 44.002, -71.006, 44.006));
    expect(relative(overlapAreaSquareMeters(polygon(square, hole), polygon(west)), withHole)).toBeLessThan(1e-9);
  });

  it("finds the overlap across the antimeridian", () => {
    const east = box(179.99, 0, 180.01, 0.01);
    const west = box(-180.01, 0, -179.99, 0.01);
    expect(relative(overlapAreaSquareMeters(polygon(east), polygon(west)), area(east))).toBeLessThan(1e-9);
    const half = box(-180, 0, -179.99, 0.01);
    expect(relative(overlapAreaSquareMeters(polygon(east), polygon(half)), area(half))).toBeLessThan(1e-9);
  });

  it("adds the overlaps of the polygons of a MultiPolygon", () => {
    const multi: MultiPolygon = { type: "MultiPolygon", coordinates: [polygon(box(0, 0, 1, 1)).coordinates, polygon(box(2, 0, 3, 1)).coordinates] };
    const band = polygon(box(0.5, 0.25, 2.5, 0.75));
    const expected = 2 * areaSquareMeters(polygon(box(0.5, 0.25, 1, 0.75)));
    expect(relative(overlapAreaSquareMeters(multi, band), expected)).toBeLessThan(1e-9);
  });

  it("is symmetric and not more than each area, for random triangles", () => {
    const corner = fc.tuple(uniformDouble({ min: -71.01, max: -71 }), uniformDouble({ min: 44, max: 44.01 }));
    const triangle = fc.tuple(corner, corner, corner).map(([p, q, r]) => polygon([p, q, r]));
    fc.assert(
      fc.property(triangle, triangle, (a, b) => {
        const ab = overlapAreaSquareMeters(a, b);
        const tolerance = 1e-9 * Math.max(1, areaSquareMeters(a), areaSquareMeters(b));
        expect(Math.abs(ab - overlapAreaSquareMeters(b, a))).toBeLessThanOrEqual(tolerance);
        expect(ab).toBeLessThanOrEqual(Math.min(areaSquareMeters(a), areaSquareMeters(b)) + tolerance);
      }),
    );
  });

  it("gives the area of the common box, for random boxes", () => {
    const span = fc.tuple(uniformDouble({ min: 0, max: 1 }), uniformDouble({ min: 0, max: 1 })).map(([u, v]) => [Math.min(u, v), Math.max(u, v)] as const);
    fc.assert(
      fc.property(span, span, span, span, ([w1, e1], [s1, n1], [w2, e2], [s2, n2]) => {
        const west = Math.max(w1, w2);
        const east = Math.min(e1, e2);
        const south = Math.max(s1, s2);
        const north = Math.min(n1, n2);
        const expected = west < east && south < north ? areaSquareMeters(polygon(box(west, south, east, north))) : 0;
        const actual = overlapAreaSquareMeters(polygon(box(w1, s1, e1, n1)), polygon(box(w2, s2, e2, n2)));
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-9 * Math.max(1, areaSquareMeters(polygon(box(0, 0, 1, 1)))));
      }),
    );
  });
});

describe("commonAreaSquareMeters", () => {
  const boxPolygon = (west: number, south: number, east: number, north: number): Polygon => polygon(box(west, south, east, north));

  it("gives the area of one polygon, and refuses an empty list", () => {
    const one = boxPolygon(-71.01, 44, -71, 44.01);
    expect(commonAreaSquareMeters([one])).toBe(areaSquareMeters(one));
    expect(() => commonAreaSquareMeters([])).toThrow(GeoError);
  });

  it("gives the common box of three boxes, and 0 when two of them are apart", () => {
    const a = boxPolygon(0, 0, 0.6, 0.6);
    const b = boxPolygon(0.2, 0.1, 1, 1);
    const c = boxPolygon(0.1, 0.3, 0.5, 0.9);
    expect(relative(commonAreaSquareMeters([a, b, c]), areaSquareMeters(boxPolygon(0.2, 0.3, 0.5, 0.6)))).toBeLessThan(1e-9);
    expect(commonAreaSquareMeters([a, b, boxPolygon(0.7, 0, 0.9, 0.05)])).toBe(0);
  });

  it("gives the area of the union of two polygons in a third by inclusion and exclusion", () => {
    // A parcel, a flood zone and a wetland with a hole. The flood zone and the wetland overlap in the parcel.
    const parcel = boxPolygon(0, 0, 1, 1);
    const flood = boxPolygon(-1, -1, 0.5, 0.6);
    const wetland = polygon(box(0.3, 0.4, 2, 0.8), box(0.6, 0.5, 0.7, 0.7));
    const union = overlapAreaSquareMeters(parcel, flood) + overlapAreaSquareMeters(parcel, wetland) - commonAreaSquareMeters([parcel, flood, wetland]);
    // The same union as boxes that do not overlap, less the hole.
    const expected =
      areaSquareMeters(boxPolygon(0, 0, 0.5, 0.6)) + areaSquareMeters(boxPolygon(0.5, 0.4, 1, 0.8)) + areaSquareMeters(boxPolygon(0.3, 0.6, 0.5, 0.8)) - areaSquareMeters(boxPolygon(0.6, 0.5, 0.7, 0.7));
    expect(relative(union, expected)).toBeLessThan(1e-9);
  });

  it("agrees with the common box of random boxes, and does not depend on the order", () => {
    const span = fc.tuple(uniformDouble({ min: 0, max: 1 }), uniformDouble({ min: 0, max: 1 })).map(([u, v]) => [Math.min(u, v), Math.max(u, v)] as const);
    const boxArb = fc.tuple(span, span);
    fc.assert(
      fc.property(boxArb, boxArb, boxArb, (...boxes) => {
        const west = Math.max(...boxes.map(([[w]]) => w));
        const east = Math.min(...boxes.map(([[, e]]) => e));
        const south = Math.max(...boxes.map(([, [s]]) => s));
        const north = Math.min(...boxes.map(([, [, n]]) => n));
        const expected = west < east && south < north ? areaSquareMeters(boxPolygon(west, south, east, north)) : 0;
        const polygons = boxes.map(([[w, e], [s, n]]) => boxPolygon(w, s, e, n));
        const tolerance = 1e-9 * areaSquareMeters(boxPolygon(0, 0, 1, 1));
        expect(Math.abs(commonAreaSquareMeters(polygons) - expected)).toBeLessThanOrEqual(tolerance);
        expect(Math.abs(commonAreaSquareMeters([...polygons].reverse()) - expected)).toBeLessThanOrEqual(tolerance);
      }),
    );
  });

  it("finds the common part across the antimeridian", () => {
    const east = boxPolygon(179.99, 0, 180.01, 0.01);
    const west = boxPolygon(-180.01, 0, -179.99, 0.01);
    const half = boxPolygon(-180, 0, -179.99, 0.01);
    expect(relative(commonAreaSquareMeters([east, west, half]), areaSquareMeters(half))).toBeLessThan(1e-9);
  });
});
