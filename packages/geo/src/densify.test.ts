import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import {
  GeoError,
  MAX_DENSIFY_POSITIONS,
  MAX_GEOJSON_DEPTH,
  bboxOfGeoJson,
  densify,
  type Geometry,
  type GeometryCollection,
  type LineString,
  type MultiLineString,
  type MultiPoint,
  type MultiPolygon,
  type Point,
  type Polygon,
  type Position,
} from "./index.ts";

/** The code and the path of the refusal, or `undefined` when the function does not refuse. */
const refusalOf = (run: () => unknown): string | undefined => {
  try {
    run();
  } catch (error) {
    if (error instanceof GeoError) return `${error.code} at "${error.path}"`;
    throw error;
  }
  return undefined;
};

const line = (coordinates: readonly Position[]): LineString => ({ type: "LineString", coordinates });

const SQUARE: readonly Position[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
  [0, 0],
];
const HOLE: readonly Position[] = [
  [1, 1],
  [1, 3],
  [3, 3],
  [3, 1],
  [1, 1],
];
const SQUARE_BY_2: readonly Position[] = [
  [0, 0],
  [2, 0],
  [4, 0],
  [4, 2],
  [4, 4],
  [2, 4],
  [0, 4],
  [0, 2],
  [0, 0],
];

describe("densify", () => {
  it("divides each edge into equal parts of the step or less, and keeps the corners", () => {
    const result = densify(
      line([
        [0, 0],
        [3, 0],
        [3, 0.5],
      ]),
      1,
    );
    expect(result).toEqual(
      line([
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [3, 0.5],
      ]),
    );
  });

  it("uses the longest of the two differences of an edge", () => {
    const result = densify(
      line([
        [10, 10],
        [13, 10],
        [10, 13],
      ]),
      2,
    );
    expect(result.coordinates).toEqual([
      [10, 10],
      [11.5, 10],
      [13, 10],
      [11.5, 11.5],
      [10, 13],
    ]);
  });

  it("does not change a geometry with no long edge", () => {
    const input = line([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
    expect(densify(input, 1)).toEqual(input);
    expect(densify(line([]), 1)).toEqual(line([]));
    expect(
      densify(
        line([
          [5, 5],
          [5, 5],
        ]),
        1,
      ).coordinates,
    ).toHaveLength(2);
  });

  it("gives a point and a multi-point as they are", () => {
    const point: Point = { type: "Point", coordinates: [1, 2] };
    const points: MultiPoint = {
      type: "MultiPoint",
      coordinates: [
        [0, 0],
        [50, 50],
      ],
    };
    expect(densify(point, 1)).toBe(point);
    expect(densify(points, 1)).toBe(points);
  });

  it("keeps each ring of a polygon closed, and keeps the other members", () => {
    const polygon: Polygon = { type: "Polygon", bbox: [0, 0, 4, 4], coordinates: [SQUARE, HOLE] };
    expect(densify(polygon, 2)).toEqual({ type: "Polygon", bbox: [0, 0, 4, 4], coordinates: [SQUARE_BY_2, HOLE] });
  });

  it("divides the edges of each part of a multi-polygon and of a multi-line", () => {
    const polygons: MultiPolygon = { type: "MultiPolygon", coordinates: [[SQUARE, HOLE], [SQUARE]] };
    expect(densify(polygons, 2).coordinates).toEqual([[SQUARE_BY_2, HOLE], [SQUARE_BY_2]]);
    const lines: MultiLineString = { type: "MultiLineString", coordinates: [SQUARE, [], HOLE] };
    expect(densify(lines, 2).coordinates).toEqual([SQUARE_BY_2, [], HOLE]);
  });

  it("divides the edges of each geometry of a collection", () => {
    const point: Point = { type: "Point", coordinates: [1, 2] };
    const inner: GeometryCollection = { type: "GeometryCollection", geometries: [line(SQUARE)] };
    const collection: GeometryCollection = { type: "GeometryCollection", geometries: [point, inner] };
    const result = densify(collection, 2);
    expect(result.geometries[0]).toBe(point);
    expect(result.geometries[1]).toEqual({ type: "GeometryCollection", geometries: [line(SQUARE_BY_2)] });
  });

  it("gives an altitude to a new position only when the two ends of its edge have one", () => {
    const withAltitude = densify(
      line([
        [0, 0, 100],
        [2, 0, 300],
      ]),
      1,
    );
    expect(withAltitude.coordinates).toEqual([
      [0, 0, 100],
      [1, 0, 200],
      [2, 0, 300],
    ]);
    const mixed = densify(
      line([
        [0, 0, 100],
        [2, 0],
      ]),
      1,
    );
    expect(mixed.coordinates).toEqual([
      [0, 0, 100],
      [1, 0],
      [2, 0],
    ]);
  });

  it("follows the straight line in longitude and latitude, not the short way across the antimeridian", () => {
    const result = densify(
      line([
        [170, 0],
        [-170, 0],
      ]),
      85,
    );
    expect(result.coordinates).toEqual([
      [170, 0],
      [85, 0],
      [0, 0],
      [-85, 0],
      [-170, 0],
    ]);
  });

  it("refuses a step that is not more than 0", () => {
    const point: Point = { type: "Point", coordinates: [1, 2] };
    expect(refusalOf(() => densify(point, 0))).toBe('step at ""');
    expect(refusalOf(() => densify(point, -1))).toBe('step at ""');
    expect(refusalOf(() => densify(point, Number.NaN))).toBe('not-finite at ""');
    expect(refusalOf(() => densify(point, Number.POSITIVE_INFINITY))).toBe('not-finite at ""');
  });

  it("refuses a step that adds more than the largest number of positions", () => {
    const long = line([
      [0, 0],
      [100, 0],
    ]);
    expect(MAX_DENSIFY_POSITIONS).toBe(1_000_000);
    expect(refusalOf(() => densify(long, 1e-5))).toBe('step at "coordinates"');
    expect(refusalOf(() => densify(long, Number.MIN_VALUE))).toBe('step at "coordinates"');
    // The limit is for one call, not for one line.
    const lines: MultiLineString = { type: "MultiLineString", coordinates: [long.coordinates, long.coordinates] };
    expect(refusalOf(() => densify(lines, 1.5e-4))).toBe('step at "coordinates[1]"');
    expect(densify(long, 1.5e-4).coordinates.length).toBeLessThanOrEqual(MAX_DENSIFY_POSITIONS);
  });

  it("refuses an incorrect geometry, with the path of the fault", () => {
    expect(
      refusalOf(() =>
        densify(
          line([
            [0, 0],
            [0, 91],
          ]),
          1,
        ),
      ),
    ).toBe('latitude-range at "coordinates[1]"');
    const polygons: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [1, 1],
            [Number.NaN, 0],
          ],
        ],
      ],
    };
    expect(refusalOf(() => densify(polygons, 1))).toBe('not-finite at "coordinates[0][0][2]"');
    const short = { type: "Point", coordinates: [1] } as unknown as Point;
    const collection: GeometryCollection = { type: "GeometryCollection", geometries: [line(SQUARE), short] };
    expect(refusalOf(() => densify(collection, 1))).toBe('position at "geometries[1].coordinates"');
    const unknown = { type: "Circle", coordinates: [] } as unknown as Geometry;
    expect(refusalOf(() => densify(unknown, 1))).toBe('geojson-type at ""');
  });

  it("refuses collections that are nested too deep", () => {
    const nested = (depth: number): Geometry => {
      let geometry: Geometry = { type: "Point", coordinates: [1, 2] };
      for (let level = 0; level < depth; level += 1) geometry = { type: "GeometryCollection", geometries: [geometry] };
      return geometry;
    };
    expect(refusalOf(() => densify(nested(MAX_GEOJSON_DEPTH), 1))).toBeUndefined();
    expect(refusalOf(() => densify(nested(MAX_GEOJSON_DEPTH + 1), 1))).toMatch(/^too-deep at /);
  });
});

describe("the properties of densify", () => {
  const position: fc.Arbitrary<Position> = fc.tuple(
    uniformDouble({ min: -180, max: 180 }),
    uniformDouble({ min: -90, max: 90 }),
  );
  const positions = fc.array(position, { maxLength: 8 });
  const step = uniformDouble({ min: 0.5, max: 40 });

  it("keeps the positions of the geometry, in the same sequence", () => {
    fc.assert(
      fc.property(positions, step, (input, maxStep) => {
        const old = new Set<Position>(input);
        const kept = densify(line(input), maxStep).coordinates.filter((item) => old.has(item));
        return kept.length === input.length && kept.every((item, index) => item === input[index]);
      }),
    );
  });

  it("gives no part that is longer than the step", () => {
    fc.assert(
      fc.property(positions, step, (input, maxStep) => {
        const result = densify(line(input), maxStep).coordinates;
        return result.every((item, index) => {
          const previous = result[index - 1];
          if (previous === undefined) return true;
          const span = Math.max(Math.abs(item[0] - previous[0]), Math.abs(item[1] - previous[1]));
          return span <= maxStep * (1 + 1e-9);
        });
      }),
    );
  });

  it("puts each new position on its edge, at equal parts", () => {
    fc.assert(
      fc.property(positions, step, (input, maxStep) => {
        const old = new Set<Position>(input);
        const result = densify(line(input), maxStep).coordinates;
        let start = 0;
        for (let end = 1; end < result.length; end += 1) {
          const b = result[end] as Position;
          if (!old.has(b)) continue;
          const a = result[start] as Position;
          for (let index = start + 1; index < end; index += 1) {
            const item = result[index] as Position;
            const part = (index - start) / (end - start);
            if (Math.abs(item[0] - (a[0] + (b[0] - a[0]) * part)) > 1e-9) return false;
            if (Math.abs(item[1] - (a[1] + (b[1] - a[1]) * part)) > 1e-9) return false;
            if (item[0] < Math.min(a[0], b[0]) || item[0] > Math.max(a[0], b[0])) return false;
            if (item[1] < Math.min(a[1], b[1]) || item[1] > Math.max(a[1], b[1])) return false;
          }
          start = end;
        }
        return true;
      }),
    );
  });

  it("gives the same positions for the two directions of a line", () => {
    fc.assert(
      fc.property(positions, step, (input, maxStep) => {
        const forward = densify(line(input), maxStep).coordinates;
        const backward = densify(line([...input].reverse()), maxStep).coordinates;
        expect(backward).toEqual([...forward].reverse());
      }),
    );
  });

  it("does not change the bounding box", () => {
    fc.assert(
      fc.property(positions, step, (input, maxStep) => {
        expect(bboxOfGeoJson(densify(line(input), maxStep))).toEqual(bboxOfGeoJson(line(input)));
      }),
    );
  });
});
