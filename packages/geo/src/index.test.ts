import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";

describe("the entry", () => {
  it("exports the functions and the constants of the package", () => {
    expect(Object.keys(entry).sort()).toEqual(
      [
        "DEFAULT_GEOHASH_PRECISION",
        "DEFAULT_MAX_GEOHASH_CELLS",
        "EARTH_MEAN_RADIUS_KM",
        "EARTH_MEAN_RADIUS_METERS",
        "GEOHASH_ALPHABET",
        "GeoError",
        "MAX_GEOHASH_PRECISION",
        "MAX_GEOJSON_DEPTH",
        "MAX_GEOMETRY_LONGITUDE",
        "bboxContains",
        "bboxIntersects",
        "bboxOfGeoJson",
        "bboxOfPoints",
        "centralAngleRadians",
        "decodeGeohash",
        "destinationKm",
        "destinationMeters",
        "distanceKm",
        "distanceMeters",
        "followsRightHandRule",
        "fromGeoJsonBBox",
        "fromPosition",
        "geohash",
        "geohashNeighbor",
        "geohashNeighbors",
        "geohashesInBBox",
        "initialBearing",
        "latLon",
        "locatePoint",
        "normalizeLon",
        "parseGeoJson",
        "parseGeometry",
        "parseLatLon",
        "polygonIntersectsBBox",
        "polygonsIntersect",
        "rewind",
        "ringWinding",
        "toGeoJsonBBox",
        "toPosition",
      ].sort(),
    );
  });
});
