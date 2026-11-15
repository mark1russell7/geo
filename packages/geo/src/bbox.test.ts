import { describe, expect, it } from "vitest";
import {
  GeoError,
  bboxContains,
  bboxIntersects,
  bboxOfGeoJson,
  bboxOfPoints,
  fromGeoJsonBBox,
  toGeoJsonBBox,
  type BBox,
  type GeoJson,
  type Geometry,
} from "./index.ts";

const box = (west: number, south: number, east: number, north: number): BBox => ({ west, south, east, north });

describe("bboxOfPoints", () => {
  it("is undefined for no point", () => {
    expect(bboxOfPoints([])).toBeUndefined();
  });

  it("is the point for one point", () => {
    expect(bboxOfPoints([{ lat: 48.8584, lon: 2.2945 }])).toEqual(box(2.2945, 48.8584, 2.2945, 48.8584));
  });

  it("does not cross the antimeridian without a need", () => {
    expect(bboxOfPoints([{ lat: 0, lon: -10 }, { lat: 5, lon: 10 }])).toEqual(box(-10, 0, 10, 5));
  });

  it("crosses the antimeridian when that is narrower", () => {
    expect(bboxOfPoints([{ lat: -20, lon: 177 }, { lat: -16, lon: -178 }])).toEqual(box(177, -20, -178, -16));
  });

  it("takes the box that does not cross when the two gaps are equal", () => {
    expect(bboxOfPoints([{ lat: 0, lon: -90 }, { lat: 0, lon: 90 }])).toEqual(box(-90, 0, 90, 0));
  });

  it("refuses an incorrect point with its index", () => {
    let thrown: unknown;
    try {
      bboxOfPoints([{ lat: 0, lon: 0 }, { lat: Number.NaN, lon: 0 }]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GeoError);
    expect((thrown as GeoError).path).toBe("[1]");
  });
});

describe("bboxOfGeoJson", () => {
  // RFC 7946, section 5.2: the box of the Fiji islands, cut at the antimeridian, is [177.0, -20.0, -178.0, -16.0].
  it("gives the RFC 7946 box of a MultiPolygon cut at the antimeridian", () => {
    const fiji: Geometry = {
      type: "MultiPolygon",
      coordinates: [
        [[[177, -20], [180, -20], [180, -16], [177, -16], [177, -20]]],
        [[[-180, -20], [-178, -20], [-178, -16], [-180, -16], [-180, -20]]],
      ],
    };
    expect(toGeoJsonBBox(bboxOfGeoJson(fiji) as BBox)).toEqual([177, -20, -178, -16]);
  });

  // RFC 7946, section 3.1.9: a MultiPolygon cut at the antimeridian, from 170 E to 170 W.
  it("gives the box of the RFC 7946 antimeridian example", () => {
    const cut: Geometry = {
      type: "MultiPolygon",
      coordinates: [
        [[[180.0, 40.0], [180.0, 50.0], [170.0, 50.0], [170.0, 40.0], [180.0, 40.0]]],
        [[[-170.0, 40.0], [-170.0, 50.0], [-180.0, 50.0], [-180.0, 40.0], [-170.0, 40.0]]],
      ],
    };
    expect(bboxOfGeoJson(cut)).toEqual(box(170, 40, -170, 50));
  });

  it("gives the box of a polygon that ends at the antimeridian without a crossing", () => {
    const east: Geometry = { type: "Polygon", coordinates: [[[170, 40], [180, 40], [180, 50], [170, 50], [170, 40]]] };
    expect(bboxOfGeoJson(east)).toEqual(box(170, 40, 180, 50));
  });

  it("reads an edge as a straight line in longitude and latitude", () => {
    // The edge from 170 to -170 goes through 0 (RFC 7946, section 3.1).
    expect(bboxOfGeoJson({ type: "LineString", coordinates: [[170, 0], [-170, 0]] })).toEqual(box(-170, 0, 170, 0));
    // With longitudes past 180, the same line crosses the antimeridian.
    expect(bboxOfGeoJson({ type: "LineString", coordinates: [[170, 0], [190, 0]] })).toEqual(box(170, 0, -170, 0));
  });

  // RFC 7946, section 5.3: the box of a polygon around a pole has the full range of longitudes.
  it("gives the full longitude range for a polygon around a pole", () => {
    const cap: Geometry = { type: "Polygon", coordinates: [[[-180, 80], [180, 80], [180, 90], [-180, 90], [-180, 80]]] };
    expect(bboxOfGeoJson(cap)).toEqual(box(-180, 80, 180, 90));
    expect(bboxOfGeoJson({ type: "LineString", coordinates: [[0, 0], [400, 1]] })).toEqual(box(-180, 0, 180, 1));
  });

  it("reads each kind of object", () => {
    const feature: GeoJson = { type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: null };
    expect(bboxOfGeoJson(feature)).toEqual(box(1, 2, 1, 2));
    expect(bboxOfGeoJson({ type: "Feature", geometry: null, properties: null })).toBeUndefined();
    const collection: GeoJson = {
      type: "FeatureCollection",
      features: [feature, { type: "Feature", geometry: null, properties: {} }, { ...feature, geometry: { type: "MultiPoint", coordinates: [[3, -4]] } }],
    };
    expect(bboxOfGeoJson(collection)).toEqual(box(1, -4, 3, 2));
    const geometries: Geometry = {
      type: "GeometryCollection",
      geometries: [
        { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]]] },
        { type: "Polygon", coordinates: [[[5, 5], [6, 5], [6, 6], [5, 5]]] },
      ],
    };
    expect(bboxOfGeoJson(geometries)).toEqual(box(0, 0, 6, 6));
    expect(bboxOfGeoJson({ type: "MultiPoint", coordinates: [] })).toBeUndefined();
  });

  it("refuses a position that is not finite", () => {
    expect(() => bboxOfGeoJson({ type: "LineString", coordinates: [[0, 0], [Number.NaN, 1]] })).toThrow(GeoError);
    expect(() => bboxOfGeoJson({ type: "Point", coordinates: [0, 100] })).toThrow(GeoError);
    expect(() => bboxOfGeoJson({ type: "Circle" } as unknown as GeoJson)).toThrow(GeoError);
  });

  it("refuses collections that are nested too deep", () => {
    let geometry: Geometry = { type: "Point", coordinates: [0, 0] };
    for (let depth = 0; depth < 40; depth += 1) geometry = { type: "GeometryCollection", geometries: [geometry] };
    expect(() => bboxOfGeoJson(geometry)).toThrow(GeoError);
  });
});

describe("bboxContains", () => {
  it("contains the points of its closed area", () => {
    const b = box(-10, -5, 10, 5);
    expect(bboxContains(b, { lat: 0, lon: 0 })).toBe(true);
    expect(bboxContains(b, { lat: 5, lon: 10 })).toBe(true);
    expect(bboxContains(b, { lat: 5.1, lon: 0 })).toBe(false);
    expect(bboxContains(b, { lat: 0, lon: 11 })).toBe(false);
    expect(bboxContains(b, { lat: 0, lon: 350 })).toBe(true);
  });

  it("contains points on the two sides of the antimeridian for a box that crosses it", () => {
    const fiji = box(177, -20, -178, -16);
    expect(bboxContains(fiji, { lat: -18, lon: 178 })).toBe(true);
    expect(bboxContains(fiji, { lat: -18, lon: -179 })).toBe(true);
    expect(bboxContains(fiji, { lat: -18, lon: 180 })).toBe(true);
    expect(bboxContains(fiji, { lat: -18, lon: 0 })).toBe(false);
  });

  it("takes -180 and 180 as one longitude", () => {
    expect(bboxContains(box(170, 0, 180, 10), { lat: 5, lon: -180 })).toBe(true);
    expect(bboxContains(box(-180, 0, -170, 10), { lat: 5, lon: 180 })).toBe(true);
  });

  it("contains a pole for each longitude when it reaches the pole", () => {
    expect(bboxContains(box(0, 80, 10, 90), { lat: 90, lon: 120 })).toBe(true);
    expect(bboxContains(box(0, -90, 10, -80), { lat: -90, lon: -120 })).toBe(true);
    expect(bboxContains(box(0, 80, 10, 89), { lat: 90, lon: 5 })).toBe(false);
  });

  it("refuses an incorrect box", () => {
    expect(() => bboxContains(box(0, 10, 1, 5), { lat: 0, lon: 0 })).toThrow(GeoError);
    expect(() => bboxContains(box(0, 0, 181, 5), { lat: 0, lon: 0 })).toThrow(GeoError);
    expect(() => bboxContains(box(0, -91, 1, 5), { lat: 0, lon: 0 })).toThrow(GeoError);
    expect(() => bboxContains(box(Number.NaN, 0, 1, 5), { lat: 0, lon: 0 })).toThrow(GeoError);
  });
});

describe("bboxIntersects", () => {
  it("finds an overlap, a touch and a gap", () => {
    expect(bboxIntersects(box(0, 0, 10, 10), box(5, 5, 15, 15))).toBe(true);
    expect(bboxIntersects(box(0, 0, 10, 10), box(10, 10, 15, 15))).toBe(true);
    expect(bboxIntersects(box(0, 0, 10, 10), box(11, 0, 15, 10))).toBe(false);
    expect(bboxIntersects(box(0, 0, 10, 10), box(0, 11, 10, 15))).toBe(false);
    expect(bboxIntersects(box(2, 2, 3, 3), box(0, 0, 10, 10))).toBe(true);
  });

  it("works across the antimeridian", () => {
    const fiji = box(177, -20, -178, -16);
    expect(bboxIntersects(fiji, box(-179, -18, -170, -10))).toBe(true);
    expect(bboxIntersects(fiji, box(170, -18, 178, -10))).toBe(true);
    expect(bboxIntersects(fiji, box(-170, -18, 170, -10))).toBe(false);
    expect(bboxIntersects(box(170, 0, 180, 10), box(-180, 0, -170, 10))).toBe(true);
    expect(bboxIntersects(box(-180, -90, 180, 90), box(10, 0, 20, 10))).toBe(true);
  });

  it("finds the common pole of two boxes", () => {
    expect(bboxIntersects(box(0, 80, 10, 90), box(100, 85, 110, 90))).toBe(true);
    expect(bboxIntersects(box(0, -90, 10, -80), box(100, -90, 110, -85))).toBe(true);
  });
});

describe("GeoJSON bounding boxes", () => {
  it("reads 4 and 6 numbers", () => {
    expect(fromGeoJsonBBox([177, -20, -178, -16])).toEqual(box(177, -20, -178, -16));
    expect(fromGeoJsonBBox([1, 2, 0, 3, 4, 100])).toEqual(box(1, 2, 3, 4));
  });

  it("refuses an incorrect array", () => {
    expect(() => fromGeoJsonBBox([1, 2, 3])).toThrow(GeoError);
    expect(() => fromGeoJsonBBox([1, 5, 3, 2])).toThrow(GeoError);
    expect(() => fromGeoJsonBBox([-190, 0, 3, 2])).toThrow(GeoError);
  });

  it("uses the rules of parseGeoJson, with the altitudes", () => {
    const codeOf = (bbox: readonly number[]): string | undefined => {
      try {
        fromGeoJsonBBox(bbox);
      } catch (error) {
        if (error instanceof GeoError) return error.code;
        throw error;
      }
      return undefined;
    };
    expect(codeOf([200, 0, 210, 1])).toBe("longitude-range");
    expect(codeOf([0, 0, 10, 1, 1, 5])).toBe("bbox");
    expect(codeOf([0, 0, Number.POSITIVE_INFINITY, 1, 1, 5])).toBe("not-finite");
    expect(codeOf([0, 0, 1, 1, 1, 5])).toBeUndefined();
  });
});
