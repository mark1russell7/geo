import { dyadic, orient2dSign } from "@mark1russell7/predicates";
import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import {
  EARTH_MEAN_RADIUS_KM,
  bboxContains,
  bboxOfGeoJson,
  bboxOfPoints,
  decodeGeohash,
  destinationKm,
  distanceKm,
  fromGeoJsonBBox,
  geohash,
  geohashNeighbor,
  geohashesInBBox,
  initialBearing,
  locatePoint,
  normalizeLon,
  parseGeoJson,
  polygonsIntersect,
  ringWinding,
  toGeoJsonBBox,
  type GeohashDirection,
  type LatLon,
  type Polygon,
  type Position,
} from "./index.ts";

const lat = uniformDouble({ min: -90, max: 90 });
const lon = uniformDouble({ min: -180, max: 180 });
const point: fc.Arbitrary<LatLon> = fc.record({ lat, lon });

/** The difference of two angles in degrees, from 0 to 180. */
const angleGap = (a: number, b: number): number => {
  const gap = Math.abs(a - b) % 360;
  return Math.min(gap, 360 - gap);
};

describe("the distance", () => {
  it("is the same when the points change places", () => {
    fc.assert(fc.property(point, point, (a, b) => distanceKm(a, b) === distanceKm(b, a)));
  });

  it("is 0 for the same point", () => {
    fc.assert(fc.property(point, (a) => distanceKm(a, a) === 0));
  });

  it("is from 0 to pi times the radius", () => {
    fc.assert(
      fc.property(point, point, (a, b) => {
        const d = distanceKm(a, b);
        return d >= 0 && d <= Math.PI * EARTH_MEAN_RADIUS_KM;
      }),
    );
  });

  it("does not change when a longitude moves by 360", () => {
    fc.assert(
      fc.property(point, point, (a, b) => {
        const moved = { lat: b.lat, lon: b.lon + 360 };
        return Math.abs(distanceKm(a, b) - distanceKm(a, moved)) <= 1e-6;
      }),
    );
  });
});

describe("the destination", () => {
  const bearing = uniformDouble({ min: 0, max: 360 }).filter((value) => value < 360);
  const distance = uniformDouble({ min: 0, max: 19_000 });

  it("is at the distance from the start", () => {
    fc.assert(
      fc.property(point, bearing, distance, (from, theta, d) => {
        const end = destinationKm(from, theta, d);
        return Math.abs(distanceKm(from, end) - d) <= 1e-6;
      }),
    );
  });

  it("is on the initial bearing from the start", () => {
    const start = fc.record({ lat: uniformDouble({ min: -89, max: 89 }), lon });
    fc.assert(
      fc.property(start, bearing, uniformDouble({ min: 1, max: 19_000 }), (from, theta, d) => {
        const end = destinationKm(from, theta, d);
        return angleGap(initialBearing(from, end), theta) <= 1e-6;
      }),
    );
  });

  it("has a normalized longitude", () => {
    fc.assert(
      fc.property(point, bearing, distance, (from, theta, d) => {
        const end = destinationKm(from, theta, d);
        return end.lon >= -180 && end.lon < 180 && end.lat >= -90 && end.lat <= 90;
      }),
    );
  });
});

describe("the geohash", () => {
  const precision = fc.integer({ min: 1, max: 12 });

  it("decodes to a cell that has the point", () => {
    fc.assert(
      fc.property(point, precision, (p, k) => {
        const cell = decodeGeohash(geohash(p, k));
        return cell.south <= p.lat && p.lat <= cell.north && cell.west <= p.lon && p.lon <= cell.east;
      }),
    );
  });

  it("gives the same geohash for the center of its cell", () => {
    fc.assert(
      fc.property(point, precision, (p, k) => {
        const hash = geohash(p, k);
        return geohash(decodeGeohash(hash).center, k) === hash;
      }),
    );
  });

  it("has neighbors that come back in the opposite direction", () => {
    const opposite: Readonly<Record<GeohashDirection, GeohashDirection>> = {
      n: "s",
      ne: "sw",
      e: "w",
      se: "nw",
      s: "n",
      sw: "ne",
      w: "e",
      nw: "se",
    };
    const direction = fc.constantFrom<GeohashDirection>("n", "ne", "e", "se", "s", "sw", "w", "nw");
    fc.assert(
      fc.property(point, precision, direction, (p, k, d) => {
        const hash = geohash(p, k);
        const next = geohashNeighbor(hash, d);
        return next === undefined || geohashNeighbor(next, opposite[d]) === hash;
      }),
    );
  });

  it("has neighbors that share an edge or a corner with the cell", () => {
    fc.assert(
      fc.property(point, precision, (p, k) => {
        const hash = geohash(p, k);
        const cell = decodeGeohash(hash);
        const north = geohashNeighbor(hash, "n");
        const east = geohashNeighbor(hash, "e");
        const northOk = north === undefined ? cell.north === 90 : decodeGeohash(north).south === cell.north;
        const eastCell = east === undefined ? undefined : decodeGeohash(east);
        const eastOk = eastCell !== undefined && (eastCell.west === cell.east || (cell.east === 180 && eastCell.west === -180));
        return northOk && eastOk;
      }),
    );
  });

  it("gives each cell one time, also for a box that crosses the antimeridian", () => {
    const box = fc.record({
      west: lon,
      // Wide boxes that cross the antimeridian often have the east column at or past the west column.
      width: fc.oneof(uniformDouble({ min: 0, max: 360 }), uniformDouble({ min: 300, max: 360 })),
      south: uniformDouble({ min: -90, max: 80 }),
      height: uniformDouble({ min: 0, max: 10 }),
      precision: fc.integer({ min: 1, max: 2 }),
    });
    fc.assert(
      fc.property(box, ({ west, width, south, height, precision: k }) => {
        const end = west + width;
        const bbox = { west, south, east: end > 180 ? normalizeLon(end) : end, north: Math.min(90, south + height) };
        const cells = geohashesInBBox(bbox, k);
        return new Set(cells).size === cells.length;
      }),
    );
  });

  it("covers each point of a box", () => {
    const box = fc.record({
      west: lon,
      width: uniformDouble({ min: 0, max: 20 }),
      south: uniformDouble({ min: -90, max: 80 }),
      height: uniformDouble({ min: 0, max: 10 }),
      s: uniformDouble({ min: 0, max: 1 }),
      t: uniformDouble({ min: 0, max: 1 }),
      precision: fc.integer({ min: 1, max: 3 }),
    });
    fc.assert(
      fc.property(box, ({ west, width, south, height, s, t, precision: k }) => {
        const wrap = (x: number): number => (x > 180 ? normalizeLon(x) : x);
        const north = Math.min(90, south + height);
        const bbox = { west, south, east: wrap(west + width), north };
        const inside = { lat: south + t * (north - south), lon: wrap(west + s * width) };
        expect(bboxContains(bbox, inside)).toBe(true);
        expect(geohashesInBBox(bbox, k)).toContain(geohash(inside, k));
      }),
    );
  });
});

/** A ring of small integer positions, with its last position equal to its first. */
const ring: fc.Arbitrary<Position[]> = fc
  .array(fc.tuple(fc.integer({ min: -5, max: 5 }), fc.integer({ min: -5, max: 5 })), { minLength: 3, maxLength: 8 })
  .map((positions) => [...positions, positions[0] as [number, number]]);

/** A coordinate on a grid of 1/8 steps from -8 to 8. A move of it by 360 has no rounding. */
const eighth = fc.integer({ min: -64, max: 64 }).map((n) => n / 8);

/** A ring on the grid of 1/8 steps. */
const coarseRing: fc.Arbitrary<Position[]> = fc
  .array(fc.tuple(eighth, eighth), { minLength: 3, maxLength: 6 })
  .map((positions) => [...positions, positions[0] as [number, number]]);

/** A ring of doubles with fine bits, with longitudes from `min` to `max`. */
const fineRing = (min: number, max: number): fc.Arbitrary<Position[]> =>
  fc
    .array(fc.tuple(uniformDouble({ min, max }), uniformDouble({ min: -10, max: 10 })), {
      minLength: 3,
      maxLength: 6,
    })
    .map((positions) => [...positions, positions[0] as [number, number]]);

/** A ring past 180 or past -180. A move of each of its vertices by 360 toward 0 has no rounding. */
const farRing: fc.Arbitrary<Position[]> = fc
  .tuple(fineRing(300, 420), fc.boolean())
  .map(([positions, west]) => (west ? positions.map(([x, y]): Position => [0 - x, y]) : positions));

const farShift = fc.constantFrom(360, -360);

/** A point with fine bits near 0. */
const finePoint: fc.Arbitrary<LatLon> = fc.record({
  lat: uniformDouble({ min: -9, max: 9 }),
  lon: uniformDouble({ min: -9, max: 9 }),
});

const moved = (positions: readonly Position[], dx: number): Position[] => positions.map(([x, y]): Position => [x + dx, y]);

/** The numerator k of the fraction k / 2^45 along an edge, from 0 to less than 2^45. */
const edgeFraction = fc
  .tuple(fc.integer({ min: 0, max: 2 ** 22 - 1 }), fc.integer({ min: 0, max: 2 ** 23 - 1 }))
  .map(([high, low]) => high * 2 ** 23 + low);

/**
 * A point exactly on an edge of a ring on the grid of 1/8 steps: A + (B - A) t, with t = k / 2^45 cut to `bits`
 * fraction bits. The product has up to 52 bits. For 45 bits, the point is a multiple of 2^-48 from -8 to 8. For 42 bits,
 * it is a multiple of 2^-45 from 128 to 256. So each step has no rounding. The point has fine bits, and its sum with
 * 360 near 0 rounds.
 */
const onEdge = (
  positions: readonly Position[],
  edge: number,
  k: number,
  bits = 45,
): { point: LatLon; a: Position; b: Position } => {
  const index = edge % (positions.length - 1);
  const a = positions[index] as Position;
  const b = positions[index + 1] as Position;
  const t = Math.floor(k / 2 ** (45 - bits)) / 2 ** bits;
  return { point: { lat: a[1] + (b[1] - a[1]) * t, lon: a[0] + (b[0] - a[0]) * t }, a, b };
};

/** A point on the grid of half steps, so that it is often on an edge or a vertex. */
const gridPoint: fc.Arbitrary<LatLon> = fc.record({
  lat: fc.integer({ min: -12, max: 12 }).map((n) => n / 2),
  lon: fc.integer({ min: -12, max: 12 }).map((n) => n / 2),
});

const polygonOf = (positions: readonly Position[]): Polygon => ({ type: "Polygon", coordinates: [positions] });

const rotate = (closed: readonly Position[], by: number): Position[] => {
  const open = closed.slice(0, -1);
  const shift = by % open.length;
  const turned = [...open.slice(shift), ...open.slice(0, shift)];
  return [...turned, turned[0] as Position];
};

describe("the point in polygon", () => {
  it("gives the same result after a cyclic shift and a reversal of the ring", () => {
    fc.assert(
      fc.property(ring, gridPoint, fc.nat(), (positions, p, by) => {
        const where = locatePoint(p, polygonOf(positions));
        expect(locatePoint(p, polygonOf(rotate(positions, by)))).toBe(where);
        expect(locatePoint(p, polygonOf([...positions].reverse()))).toBe(where);
      }),
    );
  });

  it("puts each vertex and the middle of each edge on the boundary", () => {
    fc.assert(
      fc.property(ring, (positions) => {
        const polygon = polygonOf(positions);
        for (let index = 0; index + 1 < positions.length; index += 1) {
          const [ax, ay] = positions[index] as Position;
          const [bx, by] = positions[index + 1] as Position;
          expect(locatePoint({ lat: ay, lon: ax }, polygon)).toBe("boundary");
          expect(locatePoint({ lat: (ay + by) / 2, lon: (ax + bx) / 2 }, polygon)).toBe("boundary");
        }
      }),
    );
  });

  it("gives the same result for a point and for the point moved by 360 against the sign of its longitude", () => {
    // The ring is near 150, so each point of it has a longitude of 128 or more, and lon - 360 has no rounding.
    fc.assert(
      fc.property(coarseRing, fc.nat(), edgeFraction, finePoint, (near, edge, k, offset) => {
        const positions = moved(near, 150);
        const polygon = polygonOf(positions);
        const { point, a, b } = onEdge(positions, edge, k, 42);
        expect(orient2dSign(a[0], a[1], b[0], b[1], point.lon, point.lat)).toBe(0);
        expect(locatePoint(point, polygon)).toBe("boundary");
        expect(locatePoint({ lat: point.lat, lon: point.lon - 360 }, polygon)).toBe("boundary");
        const other = { lat: offset.lat, lon: offset.lon + 150 };
        expect(locatePoint({ lat: other.lat, lon: other.lon - 360 }, polygon)).toBe(locatePoint(other, polygon));
      }),
    );
  });
});

describe("a polygon moved by 360 degrees", () => {
  it("has each point of an edge on its boundary, for a point given near 0", () => {
    fc.assert(
      fc.property(coarseRing, farShift, fc.nat(), edgeFraction, (near, shift, edge, k) => {
        const { point, a, b } = onEdge(near, edge, k);
        // The point is exactly on the edge: the exact orientation is 0.
        expect(orient2dSign(a[0], a[1], b[0], b[1], point.lon, point.lat)).toBe(0);
        expect(locatePoint(point, polygonOf(near))).toBe("boundary");
        expect(locatePoint(point, polygonOf(moved(near, shift)))).toBe("boundary");
      }),
    );
  });

  it("has each vertex on its boundary, for vertices with fine bits", () => {
    fc.assert(
      fc.property(farRing, (positions) => {
        const polygon = polygonOf(positions);
        for (const [x, y] of positions) expect(locatePoint({ lat: y, lon: x }, polygon)).toBe("boundary");
      }),
    );
  });

  it("gives the same result as the polygon before the move", () => {
    fc.assert(
      fc.property(coarseRing, farShift, finePoint, gridPoint, fc.nat(), edgeFraction, (near, shift, fine, grid, edge, k) => {
        for (const point of [fine, grid, onEdge(near, edge, k).point]) {
          expect(locatePoint(point, polygonOf(moved(near, shift)))).toBe(locatePoint(point, polygonOf(near)));
        }
      }),
    );
  });
});

describe("the winding", () => {
  it("is the opposite after a reversal, and the same after a cyclic shift", () => {
    const flip = { counterclockwise: "clockwise", clockwise: "counterclockwise", degenerate: "degenerate" } as const;
    fc.assert(
      fc.property(ring, fc.nat(), (positions, by) => {
        const winding = ringWinding(positions);
        expect(ringWinding([...positions].reverse())).toBe(flip[winding]);
        expect(ringWinding(rotate(positions, by))).toBe(winding);
      }),
    );
  });
});

describe("the overlap", () => {
  /**
   * A polygon moved by 360, and a triangle near 0 with a vertex P on an edge of the polygon before the move. So the two
   * closed polygons have the point P in common.
   */
  const touchingPair: fc.Arbitrary<readonly [Polygon, Polygon]> = fc
    .tuple(coarseRing, farShift, fc.nat(), edgeFraction, fc.array(uniformDouble({ min: -1, max: 1 }), { minLength: 4, maxLength: 4 }))
    .map(([near, shift, edge, k, [a = 0, b = 0, c = 0, d = 0]]) => {
      const { point } = onEdge(near, edge, k);
      const p: Position = [point.lon, point.lat];
      return [polygonOf(moved(near, shift)), polygonOf([p, [p[0] + a, p[1] + b], [p[0] + c, p[1] + d], p])] as const;
    });

  it("is the same in the two orders, for polygons on the two sides of the antimeridian", () => {
    // The polygon b is past 180 or past -180, or it is wide and no move of it is exact. Or the two polygons touch.
    const randomPair = fc.tuple(fineRing(-60, 60).map(polygonOf), fc.oneof(farRing, fineRing(100, 420)).map(polygonOf));
    fc.assert(fc.property(fc.oneof(randomPair, touchingPair), ([a, b]) => polygonsIntersect(a, b) === polygonsIntersect(b, a)));
  });

  it("finds a polygon that touches a polygon moved by 360 at one point, in the two orders", () => {
    fc.assert(
      fc.property(touchingPair, ([far, touching]) => {
        expect(polygonsIntersect(far, touching)).toBe(true);
        expect(polygonsIntersect(touching, far)).toBe(true);
      }),
    );
  });

  it("is found when a point of one polygon is in the other", () => {
    fc.assert(
      fc.property(ring, ring, gridPoint, (a, b, p) => {
        const inA = locatePoint(p, polygonOf(a)) !== "outside";
        const inB = locatePoint(p, polygonOf(b)) !== "outside";
        return !(inA && inB) || polygonsIntersect(polygonOf(a), polygonOf(b));
      }),
    );
  });

  it("includes each polygon with itself", () => {
    fc.assert(fc.property(ring, (a) => polygonsIntersect(polygonOf(a), polygonOf(a))));
  });
});

describe("normalizeLon", () => {
  it("does not change a longitude from -180 to less than 180, other than -0", () => {
    fc.assert(fc.property(uniformDouble({ min: -180, max: 180 }).filter((value) => value < 180), (x) => Object.is(normalizeLon(x), x + 0)));
  });

  it("is x - 360 from 180 to less than 540, and x + 360 from -540 to less than -180, with no rounding", () => {
    fc.assert(fc.property(uniformDouble({ min: 180, max: 540 }).filter((value) => value < 540), (x) => normalizeLon(x) === x - 360));
    fc.assert(fc.property(uniformDouble({ min: -540, max: -180 }).filter((value) => value < -180), (x) => normalizeLon(x) === x + 360));
  });

  it("gives a longitude from -180 to less than 180 for each finite value", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (x) => {
        const result = normalizeLon(x);
        return result >= -180 && result < 180 && !Object.is(result, -0);
      }),
    );
  });
});

describe("the bounding box", () => {
  it("has each of its points", () => {
    fc.assert(
      fc.property(fc.array(point, { minLength: 1, maxLength: 20 }), (points) => {
        const box = bboxOfPoints(points);
        return box !== undefined && points.every((p) => bboxContains(box, p));
      }),
    );
  });

  it("is the same for points and for a MultiPoint", () => {
    fc.assert(
      fc.property(fc.array(point, { maxLength: 20 }), (points) => {
        const multi = { type: "MultiPoint" as const, coordinates: points.map((p): Position => [p.lon, p.lat]) };
        expect(bboxOfGeoJson(multi)).toEqual(bboxOfPoints(points));
      }),
    );
  });

  it("is no wider than 180 degrees for two points", () => {
    fc.assert(
      fc.property(point, point, (a, b) => {
        const box = bboxOfPoints([a, b]);
        if (box === undefined) return false;
        const width = box.west <= box.east ? box.east - box.west : box.east - box.west + 360;
        return width <= 180;
      }),
    );
  });
});

describe("the GeoJSON bounding box with longitudes past 180", () => {
  /** A west in the RFC form. The west 180 is the west -180, so the west is from -180 to less than 180. */
  const westLon = lon.filter((x) => x < 180);
  /** An east in the RFC form. The east -180 is the east 180, so the east is from more than -180 to 180. */
  const eastLon = lon.filter((x) => x > -180);
  const latitudes = fc.tuple(lat, lat).map(([a, b]) => (a <= b ? ([a, b] as const) : ([b, a] as const)));
  /** The number k of a shift 360 k: often small, sometimes near 2^40. */
  const turns = fc.oneof(fc.integer({ min: -3, max: 3 }), fc.integer({ min: -(2 ** 40), max: 2 ** 40 }));

  /**
   * A longitude from -180 to 180 on a grid of steps 2^(e - 52), with 2^e more than 180 + |shift|. Then the sum of the
   * longitude and each multiple of 360 up to |shift| is a multiple of the step below 2^e, and it has no rounding.
   */
  const onGrid = (x: number, shift: number, round: (value: number) => number): number => {
    if (shift === 0) return x;
    const step = 2 ** (Math.ceil(Math.log2(180 + Math.abs(shift))) - 52);
    return round(x / step) * step;
  };

  /** It gives `true` when the floating-point sum has no rounding. */
  const exactSum = (x: number, shift: number): boolean =>
    dyadic.compare(dyadic.add(dyadic.fromFloat(x), dyadic.fromFloat(shift)), dyadic.fromFloat(x + shift)) === 0;

  /** The numbers with -0 as 0. */
  const plain = (numbers: readonly number[]): number[] => numbers.map((x) => x + 0);

  it("gives the RFC form back after a shift of 360 k of the two longitudes", () => {
    fc.assert(
      fc.property(westLon, eastLon, latitudes, turns, (w, e, [south, north], k) => {
        const shift = 360 * k;
        const west = onGrid(w, shift, Math.floor);
        const east = onGrid(e, shift, Math.ceil);
        expect(exactSum(west, shift) && exactSum(east, shift)).toBe(true);
        const box = fromGeoJsonBBox([west + shift, south, east + shift, north]);
        expect(plain(toGeoJsonBBox(box))).toEqual(plain([west, south, east, north]));
      }),
    );
  });

  it("gives the RFC form back for a box that crosses the antimeridian, with its east written past its west", () => {
    fc.assert(
      fc.property(westLon, eastLon, latitudes, turns, (w, e, [south, north], k) => {
        const shift = 360 * k;
        const west = onGrid(w, Math.abs(shift) + 360, Math.floor);
        const east = onGrid(e, Math.abs(shift) + 360, Math.ceil);
        fc.pre(west > east);
        expect(exactSum(west, shift) && exactSum(east, shift + 360)).toBe(true);
        // For example, the written box [170, 190] is the RFC box [170, -170].
        const box = fromGeoJsonBBox([west + shift, south, east + shift + 360, north]);
        expect(plain(toGeoJsonBBox(box))).toEqual(plain([west, south, east, north]));
      }),
    );
  });
});

describe("the GeoJSON parser", () => {
  it("accepts each polygon with closed rings, and refuses it when the last position moves", () => {
    fc.assert(
      fc.property(ring, (positions) => {
        expect(parseGeoJson(polygonOf(positions)).tag).toBe("ok");
        const last = positions[positions.length - 1] as Position;
        const open = [...positions.slice(0, -1), [last[0] + 0.5, last[1]] as Position];
        const result = parseGeoJson(polygonOf(open));
        expect(result.tag === "err" && result.error.code).toBe("ring-not-closed");
      }),
    );
  });
});
