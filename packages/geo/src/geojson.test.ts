import { describe, expect, it } from "vitest";
import { MAX_GEOJSON_DEPTH, parseGeoJson, parseGeometry, type GeoErrorCode } from "./index.ts";

const refusal = (value: unknown): { readonly code: GeoErrorCode; readonly path: string } | undefined => {
  const result = parseGeoJson(value);
  return result.tag === "err" ? { code: result.error.code, path: result.error.path } : undefined;
};

// The examples of RFC 7946, appendix A.
const RFC_EXAMPLES: readonly unknown[] = [
  { type: "Point", coordinates: [100.0, 0.0] },
  { type: "LineString", coordinates: [[100.0, 0.0], [101.0, 1.0]] },
  { type: "Polygon", coordinates: [[[100.0, 0.0], [101.0, 0.0], [101.0, 1.0], [100.0, 1.0], [100.0, 0.0]]] },
  {
    type: "Polygon",
    coordinates: [
      [[100.0, 0.0], [101.0, 0.0], [101.0, 1.0], [100.0, 1.0], [100.0, 0.0]],
      [[100.8, 0.8], [100.8, 0.2], [100.2, 0.2], [100.2, 0.8], [100.8, 0.8]],
    ],
  },
  { type: "MultiPoint", coordinates: [[100.0, 0.0], [101.0, 1.0]] },
  {
    type: "MultiLineString",
    coordinates: [
      [[100.0, 0.0], [101.0, 1.0]],
      [[102.0, 2.0], [103.0, 3.0]],
    ],
  },
  {
    type: "MultiPolygon",
    coordinates: [
      [[[102.0, 2.0], [103.0, 2.0], [103.0, 3.0], [102.0, 3.0], [102.0, 2.0]]],
      [
        [[100.0, 0.0], [101.0, 0.0], [101.0, 1.0], [100.0, 1.0], [100.0, 0.0]],
        [[100.2, 0.2], [100.2, 0.8], [100.8, 0.8], [100.8, 0.2], [100.2, 0.2]],
      ],
    ],
  },
  {
    type: "GeometryCollection",
    geometries: [
      { type: "Point", coordinates: [100.0, 0.0] },
      { type: "LineString", coordinates: [[101.0, 0.0], [102.0, 1.0]] },
    ],
  },
  // RFC 7946, section 1.5: a FeatureCollection with a foreign member in the properties.
  {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [102.0, 0.5] }, properties: { prop0: "value0" } },
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[102.0, 0.0], [103.0, 1.0], [104.0, 0.0], [105.0, 1.0]] },
        properties: { prop0: "value0", prop1: 0.0 },
      },
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[[100.0, 0.0], [101.0, 0.0], [101.0, 1.0], [100.0, 1.0], [100.0, 0.0]]],
        },
        properties: { prop0: "value0", prop1: { this: "that" } },
      },
    ],
  },
];

describe("parseGeoJson", () => {
  it("accepts each example of RFC 7946 and gives the same object", () => {
    for (const example of RFC_EXAMPLES) {
      const result = parseGeoJson(example);
      expect(result.tag).toBe("ok");
      if (result.tag === "ok") expect(result.value).toBe(example);
    }
  });

  it("accepts a Feature with a null geometry, null properties, an id and a bbox", () => {
    expect(parseGeoJson({ type: "Feature", geometry: null, properties: null, id: 7 }).tag).toBe("ok");
    expect(parseGeoJson({ type: "Feature", geometry: null, properties: {}, id: "a" }).tag).toBe("ok");
    // RFC 7946, section 5.2: a box across the antimeridian has west more than east.
    expect(parseGeoJson({ type: "Feature", bbox: [177.0, -20.0, -178.0, -16.0], geometry: null, properties: null }).tag).toBe(
      "ok",
    );
    expect(parseGeoJson({ type: "Point", bbox: [1, 2, 0, 1, 2, 10], coordinates: [1, 2, 5] }).tag).toBe("ok");
  });

  it("keeps foreign members", () => {
    const value = { type: "Point", coordinates: [1, 2], title: "a foreign member" };
    const result = parseGeoJson(value);
    expect(result.tag === "ok" && result.value).toBe(value);
  });

  it("accepts empty coordinates for the multi types and the lines", () => {
    expect(parseGeoJson({ type: "LineString", coordinates: [] }).tag).toBe("ok");
    expect(parseGeoJson({ type: "Polygon", coordinates: [] }).tag).toBe("ok");
    expect(parseGeoJson({ type: "MultiPolygon", coordinates: [] }).tag).toBe("ok");
  });

  it("accepts a longitude past 180", () => {
    expect(parseGeoJson({ type: "LineString", coordinates: [[170, 0], [190, 0]] }).tag).toBe("ok");
  });

  it("refuses an unclosed ring", () => {
    expect(refusal({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] })).toEqual({
      code: "ring-not-closed",
      path: "coordinates[0]",
    });
  });

  it("refuses a ring with fewer than four positions", () => {
    expect(refusal({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0]]] })?.code).toBe("too-few-positions");
  });

  it("refuses a line with one position", () => {
    expect(refusal({ type: "LineString", coordinates: [[0, 0]] })?.code).toBe("too-few-positions");
    expect(refusal({ type: "MultiLineString", coordinates: [[[0, 0]]] })?.path).toBe("coordinates[0]");
  });

  it("refuses an incorrect position with its path", () => {
    expect(refusal({ type: "Point", coordinates: [1] })).toEqual({ code: "position", path: "coordinates" });
    expect(refusal({ type: "Point", coordinates: [1, "2"] })?.code).toBe("position");
    expect(refusal({ type: "Point", coordinates: [Number.NaN, 2] })?.code).toBe("not-finite");
    expect(refusal({ type: "Point", coordinates: [0, 91] })?.code).toBe("latitude-range");
    expect(refusal({ type: "MultiPoint", coordinates: [[0, 0], [0, -95]] })).toEqual({
      code: "latitude-range",
      path: "coordinates[1]",
    });
    expect(refusal({ type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[0, 0]]]] })?.path).toBe(
      "coordinates[1][0]",
    );
  });

  it("refuses a value that is not an array where an array must be", () => {
    expect(refusal({ type: "MultiPoint", coordinates: "none" })?.code).toBe("geojson-member");
    expect(refusal({ type: "GeometryCollection" })).toEqual({ code: "geojson-member", path: "geometries" });
    expect(refusal({ type: "GeometryCollection", geometries: [5] })).toEqual({ code: "geojson-member", path: "geometries[0]" });
    expect(refusal({ type: "FeatureCollection", features: {} })).toEqual({ code: "geojson-member", path: "features" });
  });

  it("refuses an unknown type and a value that is not an object", () => {
    expect(refusal({ type: "Circle", coordinates: [0, 0] })?.code).toBe("geojson-type");
    expect(refusal({ coordinates: [0, 0] })?.code).toBe("geojson-type");
    expect(refusal([1, 2])?.code).toBe("geojson-member");
    expect(refusal(null)?.code).toBe("geojson-member");
    expect(refusal("Point")?.code).toBe("geojson-member");
  });

  it("refuses an incorrect Feature", () => {
    expect(refusal({ type: "Feature", properties: null })?.code).toBe("geojson-member");
    expect(refusal({ type: "Feature", geometry: null })?.code).toBe("geojson-member");
    expect(refusal({ type: "Feature", geometry: null, properties: [] })).toEqual({ code: "geojson-member", path: "properties" });
    expect(refusal({ type: "Feature", geometry: null, properties: null, id: true })).toEqual({
      code: "geojson-member",
      path: "id",
    });
    expect(refusal({ type: "Feature", geometry: { type: "Point", coordinates: [0] }, properties: null })?.path).toBe(
      "geometry.coordinates",
    );
    expect(refusal({ type: "FeatureCollection", features: [{ type: "Point", coordinates: [0, 0] }] })).toEqual({
      code: "geojson-type",
      path: "features[0]",
    });
    expect(
      refusal({ type: "FeatureCollection", features: [{ type: "Feature", geometry: null, properties: 3 }] })?.path,
    ).toBe("features[0].properties");
  });

  it("refuses an incorrect bbox", () => {
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, 0, 1] })).toEqual({ code: "bbox", path: "bbox" });
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, 0, 1, "1"] })?.code).toBe("bbox");
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, 0, 1, Number.NaN] })?.code).toBe("not-finite");
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, 10, 1, 5] })?.code).toBe("bbox");
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, -95, 1, 5] })?.code).toBe("latitude-range");
    // A bounding box accepts each finite longitude, as a position does.
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [200, 0, 210, 1] })).toBeUndefined();
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [-180.5, 0, 10, 1] })).toBeUndefined();
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [Number.POSITIVE_INFINITY, 0, 10, 1] })).toEqual({
      code: "not-finite",
      path: "bbox",
    });
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [200, 0, 210, 95] })?.code).toBe("latitude-range");
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [200, 10, 210, 5] })?.code).toBe("bbox");
    // With 6 numbers, the low altitude must not be more than the high altitude.
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, 0, 10, 1, 1, 5] })).toEqual({ code: "bbox", path: "bbox" });
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, 0, 5, 1, 1, 5] })).toBeUndefined();
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, 0, Number.NaN, 1, 1, 5] })?.code).toBe("not-finite");
    expect(refusal({ type: "Point", coordinates: [0, 0], bbox: [0, 20, 0, 1, 10, 5] })?.code).toBe("bbox");
    expect(refusal({ type: "Feature", geometry: null, properties: null, bbox: [1] })?.path).toBe("bbox");
    expect(refusal({ type: "FeatureCollection", features: [], bbox: [1] })?.path).toBe("bbox");
  });

  it("accepts a bbox in the frame of the coordinates, past 180", () => {
    const polygon = {
      type: "Polygon",
      bbox: [170, -20, 190, -16],
      coordinates: [[[170, -20], [190, -20], [190, -16], [170, -16], [170, -20]]],
    };
    const result = parseGeoJson(polygon);
    expect(result.tag).toBe("ok");
    expect(result.tag === "ok" && result.value).toBe(polygon);
    // RFC 7946, section 5.2, writes the same box as [170, -20, -170, -16]. That form stays correct.
    expect(refusal({ ...polygon, bbox: [170, -20, -170, -16] })).toBeUndefined();
    expect(refusal({ type: "Feature", geometry: polygon, properties: null, bbox: [-190, -20, -170, -16] })).toBeUndefined();
    expect(refusal({ type: "FeatureCollection", features: [], bbox: [530, -20, 0, 550, -16, 1] })).toBeUndefined();
  });

  it("refuses collections that are nested too deep", () => {
    let geometry: unknown = { type: "Point", coordinates: [0, 0] };
    for (let depth = 0; depth < MAX_GEOJSON_DEPTH; depth += 1) geometry = { type: "GeometryCollection", geometries: [geometry] };
    expect(parseGeoJson(geometry).tag).toBe("ok");
    expect(refusal({ type: "GeometryCollection", geometries: [geometry] })?.code).toBe("too-deep");
  });

  it("does not catch an error that is not a GeoError", () => {
    const hostile = {
      type: "Point",
      get coordinates(): never {
        throw new TypeError("a getter that throws");
      },
    };
    expect(() => parseGeoJson(hostile)).toThrow(TypeError);
  });
});

describe("parseGeometry", () => {
  it("accepts a geometry", () => {
    expect(parseGeometry({ type: "Point", coordinates: [0, 0] }).tag).toBe("ok");
  });

  it("refuses a Feature", () => {
    const result = parseGeometry({ type: "Feature", geometry: null, properties: null });
    expect(result.tag === "err" && result.error.code).toBe("geojson-type");
  });
});
