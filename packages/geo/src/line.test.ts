import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import { GeoError } from "./errors.ts";
import { geodesicInverse } from "./geodesic.ts";
import { joinLines, lengthNearLines, lineReference, nearestOnLine, pointAlongLine } from "./line.ts";
import type { LatLon, Position } from "./point.ts";
import { WEB_MERCATOR, type Projection } from "./projection.ts";

// The coordinates are made up: short lines in the ocean near the point (0, 0), and lines at random places.

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return error.code;
    throw error;
  }
  return undefined;
}

function path(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return error.path;
    throw error;
  }
  return undefined;
}

const meters = (a: LatLon, b: LatLon): number => geodesicInverse(a, b).meters;
const at = (position: Position): LatLon => ({ lat: position[1], lon: position[0] });

const A: Position = [0, 0];
const B: Position = [0.001, 0];
const C: Position = [0.002, 0];
const D: Position = [0.003, 0];
const E: Position = [0.003, 0.001];

describe("joinLines", () => {
  it("joins lines out of order and in reverse into one line", () => {
    expect(joinLines([[C, D], [B, A], [B, C]])).toEqual([[A, B, C, D]]);
    expect(joinLines([[A, B], [C, B], [D, C]])).toEqual([[A, B, C, D]]);
  });

  it("keeps the direction of the first line and gives the input positions", () => {
    const high: Position = [0.001, 0, 12];
    const [line] = joinLines([[C, high], [A, high]]);
    expect(line).toEqual([C, high, A]);
    expect(line?.[1]).toBe(high);
  });

  it("keeps lines with no common end apart, in the input order", () => {
    expect(joinLines([[C, D], [A, B]])).toEqual([[C, D], [A, B]]);
    expect(joinLines([])).toEqual([]);
  });

  it("takes the first line in the input order at an end of three lines", () => {
    // Three lines meet at C. The line to E comes first, so the line to D starts a new line.
    expect(joinLines([[A, B, C], [C, E], [C, D]])).toEqual([[A, B, C, E], [C, D]]);
  });

  it("closes a loop", () => {
    expect(joinLines([[A, B], [B, E], [E, A]])).toEqual([[A, B, E, A]]);
  });

  it("joins ends at 180 and -180, and ends at a pole", () => {
    expect(joinLines([[[179.999, 1], [180, 1]], [[-180, 1], [-179.999, 1]]])).toEqual([[[179.999, 1], [180, 1], [-179.999, 1]]]);
    expect(joinLines([[[10, 89], [10, 90]], [[-70, 90], [-70, 89]]])).toEqual([[[10, 89], [10, 90], [-70, 89]]]);
  });

  it("refuses an incorrect line with its path", () => {
    expect(code(() => joinLines([[A, B], [C]]))).toBe("too-few-positions");
    expect(path(() => joinLines([[A, B], [C]]))).toBe("[1]");
    expect(code(() => joinLines([[A, [0, 91]]]))).toBe("latitude-range");
    expect(path(() => joinLines([[A, [0, 91]]]))).toBe("[0][1]");
    expect(code(() => joinLines([[A, [Number.NaN, 0]]]))).toBe("not-finite");
    expect(code(() => joinLines("lines" as unknown as Position[][]))).toBe("geojson-member");
    expect(code(() => joinLines([7 as unknown as Position[]]))).toBe("geojson-member");
  });

  it("gives the line back from its parts in each order and direction", () => {
    const line = fc
      .array(fc.tuple(uniformDouble({ min: -10, max: 10 }), uniformDouble({ min: -10, max: 10 })), { minLength: 2, maxLength: 12 })
      .filter((list) => new Set(list.map(([lon, lat]) => `${lat},${lon}`)).size === list.length);
    fc.assert(
      fc.property(line, fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), fc.integer(), (positions, cuts, flips, seed) => {
        // The parts of the line, cut at some inner positions.
        const parts: Position[][] = [];
        let part: Position[] = [positions[0] as Position];
        positions.slice(1).forEach((position, index) => {
          part.push(position);
          if (cuts[index] === true && index < positions.length - 2) {
            parts.push(part);
            part = [position];
          }
        });
        parts.push(part);
        const shuffled = parts
          .map((item, index) => ({ item: flips[index] === true ? [...item].reverse() : item, order: (seed * (index + 7)) % 13 }))
          .sort((x, y) => x.order - y.order)
          .map(({ item }) => item);
        const joined = joinLines(shuffled);
        expect(joined).toHaveLength(1);
        const result = joined[0] as Position[];
        const forward = result[0] === positions[0] ? result : [...result].reverse();
        expect(forward).toEqual(positions);
      }),
      { numRuns: 200 },
    );
  });
});

describe("lineReference", () => {
  // A line of approximately 334 m to the east along the equator.
  const east: Position[] = [A, B, C, D];

  it("gives the length of the line on the ellipsoid", () => {
    const line = lineReference(east);
    expect(line.lengthMeters).toBeCloseTo(meters(at(A), at(D)), 3);
    expect(line.projection.name).toBe("Azimuthal equidistant");
  });

  it("gives the distance, the distance along the line and the side", () => {
    const line = lineReference(east);
    const north = { lat: 0.0005, lon: 0.0015 };
    const nearest = line.nearest(north);
    expect(nearest.side).toBe(1);
    expect(nearest.point.lat).toBeCloseTo(0, 9);
    expect(nearest.point.lon).toBeCloseTo(0.0015, 8);
    expect(nearest.meters).toBeCloseTo(meters(north, nearest.point), 3);
    expect(nearest.alongMeters).toBeCloseTo(meters(at(A), nearest.point), 3);
    expect(line.nearest({ lat: -0.0005, lon: 0.0015 }).side).toBe(-1);
  });

  it("gives an end for a point past an end", () => {
    const line = lineReference(east);
    const before = line.nearest({ lat: 0.0001, lon: -0.001 });
    expect(before.alongMeters).toBe(0);
    expect(before.point).toEqual({ lat: 0, lon: 0 });
    const after = line.nearest({ lat: 0, lon: 0.004 });
    expect(after.alongMeters).toBeCloseTo(line.lengthMeters, 6);
    expect(after.meters).toBeCloseTo(meters(at(D), { lat: 0, lon: 0.004 }), 3);
  });

  it("gives the side 0 for a position of the line", () => {
    const nearest = lineReference(east).nearest(at(C));
    expect(nearest.meters).toBe(0);
    expect(nearest.side).toBe(0);
  });

  it("measures along a line with a corner", () => {
    // To the east, then to the north. A point to the east of the second segment is on its right side.
    const line = lineReference([A, D, E]);
    const point = { lat: 0.0005, lon: 0.0031 };
    const nearest = line.nearest(point);
    expect(nearest.side).toBe(-1);
    expect(nearest.alongMeters).toBeCloseTo(meters(at(A), at(D)) + meters(at(D), { lat: 0.0005, lon: 0.003 }), 2);
    const back = line.pointAt(nearest.alongMeters, -nearest.meters);
    expect(meters(back, point)).toBeLessThan(0.001);
  });

  it("gives the point at a distance with an offset to the left or to the right", () => {
    const line = lineReference(east);
    const half = line.lengthMeters / 2;
    const middle = line.pointAt(half);
    expect(middle.lat).toBeCloseTo(0, 9);
    expect(middle.lon).toBeCloseTo(0.0015, 6);
    const left = line.pointAt(half, 20);
    expect(left.lat).toBeGreaterThan(0);
    expect(meters(left, middle)).toBeCloseTo(20, 3);
    expect(line.pointAt(half, -20).lat).toBeLessThan(0);
  });

  it("gives the ends for a distance out of the line", () => {
    const line = lineReference(east);
    expect(line.pointAt(-5)).toEqual({ lat: 0, lon: 0 });
    const end = line.pointAt(line.lengthMeters + 5);
    expect(meters(end, at(D))).toBeLessThan(1e-6);
  });

  it("skips a segment of length 0", () => {
    const line = lineReference([A, A, B, B, C]);
    expect(line.lengthMeters).toBeCloseTo(meters(at(A), at(C)), 3);
    expect(line.pointAt(0, 10).lat).toBeGreaterThan(0);
    expect(line.pointAt(line.lengthMeters, 10).lat).toBeGreaterThan(0);
    expect(line.nearest({ lat: 0.0001, lon: 0 }).side).toBe(1);
  });

  it("gives the first position for a line of length 0", () => {
    const line = lineReference([B, B]);
    expect(line.lengthMeters).toBe(0);
    const nearest = line.nearest({ lat: 0.001, lon: 0.001 });
    expect(nearest.alongMeters).toBe(0);
    expect(nearest.side).toBe(0);
    expect(nearest.meters).toBeCloseTo(meters({ lat: 0.001, lon: 0.001 }, at(B)), 3);
    expect(line.pointAt(3, 10)).toEqual({ lat: 0, lon: 0.001 });
  });

  it("uses a different plane", () => {
    // At 60 degrees, a length on Web Mercator along the parallel is approximately two times the true length.
    const north: Position[] = [[10, 60], [10.01, 60]];
    const line = lineReference(north, { projection: WEB_MERCATOR });
    expect(line.projection).toBe(WEB_MERCATOR);
    expect(line.lengthMeters / lineReference(north).lengthMeters).toBeCloseTo(WEB_MERCATOR.scale({ lat: 60, lon: 10 }).min, 4);
  });

  it("refuses an incorrect line, point or distance", () => {
    expect(code(() => lineReference([A]))).toBe("too-few-positions");
    expect(code(() => lineReference([A, [0, -91]]))).toBe("latitude-range");
    expect(path(() => lineReference([A, [0, -91]]))).toBe("[1]");
    expect(code(() => lineReference(east).nearest({ lat: 95, lon: 0 }))).toBe("latitude-range");
    expect(code(() => lineReference(east).pointAt(Number.NaN))).toBe("not-finite");
    expect(code(() => lineReference(east).pointAt(1, Number.POSITIVE_INFINITY))).toBe("not-finite");
  });

  it("gives back the distance and the offset of a point along a segment", () => {
    const place = fc.record({ lat: uniformDouble({ min: -60, max: 60 }), lon: uniformDouble({ min: -180, max: 179 }) });
    fc.assert(
      fc.property(
        place,
        uniformDouble({ min: -0.01, max: 0.01 }),
        uniformDouble({ min: -0.01, max: 0.01 }),
        uniformDouble({ min: 0, max: 1 }),
        uniformDouble({ min: -50, max: 50 }),
        (start, dlat, dlon, part, offset) => {
          fc.pre(Math.abs(dlat) + Math.abs(dlon) > 0.002 && Math.abs(offset) > 0.01);
          const line = lineReference([
            [start.lon, start.lat],
            [start.lon + dlon, start.lat + dlat],
          ]);
          const along = part * line.lengthMeters;
          const nearest = line.nearest(line.pointAt(along, offset));
          expect(nearest.alongMeters).toBeCloseTo(along, 4);
          expect(nearest.meters).toBeCloseTo(Math.abs(offset), 4);
          expect(nearest.side).toBe(Math.sign(offset));
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("nearestOnLine and pointAlongLine", () => {
  it("give the results of lineReference", () => {
    const line: Position[] = [A, D, E];
    const point = { lat: 0.0004, lon: 0.002 };
    expect(nearestOnLine(line, point)).toEqual(lineReference(line).nearest(point));
    expect(pointAlongLine(line, 100, -3)).toEqual(lineReference(line).pointAt(100, -3));
    expect(pointAlongLine(line, 100)).toEqual(lineReference(line).pointAt(100));
    expect(nearestOnLine(line, point, { projection: WEB_MERCATOR })).toEqual(lineReference(line, { projection: WEB_MERCATOR }).nearest(point));
  });
});

// A flat plane for the tests of lengthNearLines: x is the longitude and y is the latitude, with no change. So each
// length is in the units of the made-up coordinates, and a test can give an exact answer.
const FLAT: Projection = Object.freeze({
  name: "Flat test plane",
  toPlane: (point: LatLon) => ({ x: point.lon, y: point.lat }),
  fromPlane: (point: { x: number; y: number }) => ({ lat: point.y, lon: point.x }),
  scale: () => ({ max: 1, min: 1 }),
});

/** The distance from a point to a segment, on the flat plane. */
function segmentDistance(px: number, py: number, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const squared = dx * dx + dy * dy;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / squared));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

describe("lengthNearLines", () => {
  it("gives the frontage of a square along a road: one side and a part of the two sides next to it", () => {
    const square: Position[] = [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]];
    const road: Position[] = [[-20, -5], [70, -5]];
    const near = lengthNearLines(square, [road], 10, { projection: FLAT });
    expect(near.lengthMeters).toBe(200);
    expect(near.meters).toBeCloseTo(60, 9);
    expect(near.parts).toHaveLength(2);
    expect(near.parts[0]!.fromMeters).toBeCloseTo(0, 9);
    expect(near.parts[0]!.toMeters).toBeCloseTo(55, 9);
    expect(near.parts[1]!.fromMeters).toBeCloseTo(195, 9);
    expect(near.parts[1]!.toMeters).toBeCloseTo(200, 9);
  });

  it("gives the part on another line for the distance 0", () => {
    const near = lengthNearLines([[0, 0], [10, 0]], [[[5, 0], [20, 0]]], 0, { projection: FLAT });
    expect(near.meters).toBeCloseTo(5, 9);
    expect(near.parts).toEqual([{ fromMeters: 5, toMeters: 10 }]);
  });

  it("gives the crossing of a road at right angles, and the round end of a road", () => {
    const line: Position[] = [[0, 0], [50, 0]];
    expect(lengthNearLines(line, [[[25, -10], [25, 10]]], 3, { projection: FLAT }).meters).toBeCloseTo(6, 9);
    // A road that ends 4 from the line: the near set at its end is a disk, so the part is 2 * sqrt(5^2 - 4^2) = 6.
    expect(lengthNearLines(line, [[[25, 4], [25, 30]]], 5, { projection: FLAT }).meters).toBeCloseTo(6, 9);
    // A road of length 0 is a disk.
    expect(lengthNearLines(line, [[[25, 4], [25, 4]]], 5, { projection: FLAT }).meters).toBeCloseTo(6, 9);
  });

  it("joins the parts of two roads that overlap, and gives 0 with no road", () => {
    const line: Position[] = [[0, 0], [50, 0]];
    const near = lengthNearLines(line, [[[0, 1], [20, 1]], [[15, -1], [30, -1]]], 2, { projection: FLAT });
    expect(near.parts).toHaveLength(1);
    expect(near.meters).toBeCloseTo(30 + Math.sqrt(3), 9);
    expect(lengthNearLines(line, [], 10, { projection: FLAT })).toEqual({ meters: 0, lengthMeters: 50, parts: [] });
  });

  it("is equal to a dense sample of the line, for random lines", () => {
    const position = fc.tuple(uniformDouble({ min: -40, max: 40 }), uniformDouble({ min: -40, max: 40 })) as fc.Arbitrary<Position>;
    const polyline = fc.array(position, { minLength: 2, maxLength: 5 });
    fc.assert(
      fc.property(polyline, fc.array(polyline, { minLength: 1, maxLength: 3 }), uniformDouble({ min: 0.5, max: 15 }), (line, others, within) => {
        const near = lengthNearLines(line, others, within, { projection: FLAT });
        const steps = 2000;
        let sampled = 0;
        let crossings = 2;
        for (let index = 1; index < line.length; index += 1) {
          const a = line[index - 1] as Position;
          const b = line[index] as Position;
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let step = 0; step < steps; step += 1) {
            const t = (step + 0.5) / steps;
            const x = a[0] + t * (b[0] - a[0]);
            const y = a[1] + t * (b[1] - a[1]);
            const inside = others.some((other) => other.slice(1).some((end, k) => segmentDistance(x, y, other[k] as Position, end) <= within));
            if (inside) sampled += length / steps;
          }
          crossings += 2;
        }
        const step = near.lengthMeters / steps;
        const segments = others.reduce((sum, other) => sum + other.length, 0);
        expect(Math.abs(near.meters - sampled)).toBeLessThanOrEqual(step * crossings * segments + 1e-9);
        expect(near.meters).toBeLessThanOrEqual(near.lengthMeters + 1e-9);
        near.parts.forEach((part, index) => {
          expect(part.toMeters).toBeGreaterThanOrEqual(part.fromMeters);
          if (index > 0) expect(part.fromMeters).toBeGreaterThan(near.parts[index - 1]!.toMeters);
        });
      }),
      { numRuns: 60 },
    );
  });

  it("measures on the plane of the line by default, for a road 10 m from a street", () => {
    const lat = 44.5;
    const street: Position[] = [[-71.002, lat], [-71, lat]];
    // 10 m to the north is 10 / 111,130 degrees of latitude, approximately.
    const road: Position[] = [[-71.003, lat + 10 / 111_130], [-70.999, lat + 10 / 111_130]];
    const near = lengthNearLines(street, [road], 15);
    const length = geodesicInverse({ lat, lon: -71.002 }, { lat, lon: -71 }).meters;
    expect(near.lengthMeters / length).toBeCloseTo(1, 4);
    expect(near.meters).toBeCloseTo(near.lengthMeters, 6);
    expect(lengthNearLines(street, [road], 5).meters).toBe(0);
  });

  it("refuses a negative distance, a distance that is not finite, and a line with one position", () => {
    const line: Position[] = [[0, 0], [1, 0]];
    expect(code(() => lengthNearLines(line, [], -1))).toBe("tolerance");
    expect(code(() => lengthNearLines(line, [], Number.NaN))).toBe("not-finite");
    expect(code(() => lengthNearLines(line, [[[0, 1]]], 1))).toBe("too-few-positions");
    expect(code(() => lengthNearLines([[0, 0]], [], 1))).toBe("too-few-positions");
    expect(code(() => lengthNearLines(line, "x" as never, 1))).toBe("geojson-member");
  });
});
