import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  EARTH_MEAN_RADIUS_KM,
  bboxContains,
  bboxOfGeoJson,
  bboxOfPoints,
  decodeGeohash,
  destinationKm,
  distanceKm,
  geohash,
  geohashNeighbor,
  geohashesInBBox,
  initialBearing,
  locatePoint,
  normalizeLon,
  parseGeoJson,
  polygonsIntersect,
  ringWinding,
  type GeohashDirection,
  type LatLon,
  type Polygon,
  type Position,
} from "./index.ts";

const lat = fc.double({ min: -90, max: 90, noNaN: true });
const lon = fc.double({ min: -180, max: 180, noNaN: true });
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
  const bearing = fc.double({ min: 0, max: 360, maxExcluded: true, noNaN: true });
  const distance = fc.double({ min: 0, max: 19_000, noNaN: true });

  it("is at the distance from the start", () => {
    fc.assert(
      fc.property(point, bearing, distance, (from, theta, d) => {
        const end = destinationKm(from, theta, d);
        return Math.abs(distanceKm(from, end) - d) <= 1e-6;
      }),
    );
  });

  it("is on the initial bearing from the start", () => {
    const start = fc.record({ lat: fc.double({ min: -89, max: 89, noNaN: true }), lon });
    fc.assert(
      fc.property(start, bearing, fc.double({ min: 1, max: 19_000, noNaN: true }), (from, theta, d) => {
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

  it("covers each point of a box", () => {
    const box = fc.record({
      west: lon,
      width: fc.double({ min: 0, max: 20, noNaN: true }),
      south: fc.double({ min: -90, max: 80, noNaN: true }),
      height: fc.double({ min: 0, max: 10, noNaN: true }),
      s: fc.double({ min: 0, max: 1, noNaN: true }),
      t: fc.double({ min: 0, max: 1, noNaN: true }),
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

  it("gives the same result for a point and for the point 360 degrees away", () => {
    fc.assert(
      fc.property(ring, gridPoint, (positions, p) => {
        const polygon = polygonOf(positions);
        return locatePoint(p, polygon) === locatePoint({ lat: p.lat, lon: p.lon + 360 }, polygon);
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
  it("is the same in the two orders", () => {
    fc.assert(
      fc.property(ring, ring, (a, b) => polygonsIntersect(polygonOf(a), polygonOf(b)) === polygonsIntersect(polygonOf(b), polygonOf(a))),
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
