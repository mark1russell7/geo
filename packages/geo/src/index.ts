/**
 * This package has functions for places on the Earth: points on WGS84, great-circle distances and bearings, and
 * bounding boxes that can cross the antimeridian. It also has point-in-polygon and overlap tests for GeoJSON on exact
 * predicates, geohashes, and the types of GeoJSON (RFC 7946). The README gives the limits of the exact results.
 * The functions are pure, and each refuses an incorrect input with a `GeoError`.
 *
 * @packageDocumentation
 */

export { GeoError, type GeoErrorCode } from "./errors.ts";
export {
  fromPosition,
  latLon,
  normalizeLon,
  parseLatLon,
  toPosition,
  type LatLon,
  type Position,
} from "./point.ts";
export {
  centralAngleRadians,
  destinationKm,
  destinationMeters,
  distanceKm,
  distanceMeters,
  EARTH_MEAN_RADIUS_KM,
  EARTH_MEAN_RADIUS_METERS,
  initialBearing,
} from "./sphere.ts";
export {
  bboxContains,
  bboxIntersects,
  bboxOfGeoJson,
  bboxOfPoints,
  fromGeoJsonBBox,
  toGeoJsonBBox,
  type BBox,
} from "./bbox.ts";
export {
  followsRightHandRule,
  locatePoint,
  MAX_GEOMETRY_LONGITUDE,
  polygonIntersectsBBox,
  polygonsIntersect,
  rewind,
  ringWinding,
  type PointLocation,
  type RingWinding,
} from "./polygon.ts";
export {
  decodeGeohash,
  DEFAULT_GEOHASH_PRECISION,
  DEFAULT_MAX_GEOHASH_CELLS,
  GEOHASH_ALPHABET,
  geohash,
  geohashesInBBox,
  geohashNeighbor,
  geohashNeighbors,
  MAX_GEOHASH_PRECISION,
  type GeohashCell,
  type GeohashDirection,
  type GeohashNeighbors,
} from "./geohash.ts";
export {
  MAX_GEOJSON_DEPTH,
  parseGeoJson,
  parseGeometry,
  type Feature,
  type FeatureCollection,
  type GeoJson,
  type GeoJsonBBox,
  type GeoJsonObject,
  type GeoJsonProperties,
  type Geometry,
  type GeometryCollection,
  type LineString,
  type MultiLineString,
  type MultiPoint,
  type MultiPolygon,
  type Point,
  type Polygon,
} from "./geojson.ts";
