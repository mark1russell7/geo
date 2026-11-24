/**
 * This package has functions for places on the Earth: points on WGS84, great-circle distances and bearings,
 * and bounding boxes that can cross the antimeridian. It gives geodesics on an ellipsoid as WGS84. It also has
 * point-in-polygon and overlap tests for GeoJSON on exact predicates, and a locator for many points in one polygon.
 * It gives the area of a polygon and the area of the common part of two or more polygons on an ellipsoid.
 *
 * It has geohashes and the types of GeoJSON (RFC 7946). It simplifies regions that share borders, and it gives
 * a circle and the buffer of a geometry as polygons, for maps. The README gives the limits of the exact results.
 * For a globe, it gives a point as a unit vector, the points along a great circle, and a geometry with short edges.
 * For lines, it joins lines at common ends, and it gives the nearest point of a line and a point along a line.
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
  fromUnitVector,
  initialBearing,
  intermediatePoint,
  toUnitVector,
  type UnitVector,
} from "./sphere.ts";
export {
  geodesicDirect,
  geodesicInverse,
  WGS84,
  type Ellipsoid,
  type GeodesicDirect,
  type GeodesicInverse,
} from "./geodesic.ts";
export {
  bboxCenter,
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
export { areaSquareMeters, commonAreaSquareMeters, overlapAreaSquareMeters } from "./area.ts";
export { bufferKm, bufferMeters, DEFAULT_MAX_BUFFER_CELLS, type BufferOptions } from "./buffer.ts";
export { densify, MAX_DENSIFY_POSITIONS } from "./densify.ts";
export {
  joinLines,
  lineReference,
  nearestOnLine,
  pointAlongLine,
  type LineOptions,
  type LineReference,
  type LineSide,
  type NearestOnLine,
} from "./line.ts";
export { pointLocator, type PointLocator } from "./locator.ts";
export {
  circleKm,
  circleMeters,
  DEFAULT_CIRCLE_VERTICES,
  MAX_CIRCLE_VERTICES,
  type CircleOptions,
} from "./circle.ts";
export {
  distanceBetweenGeometriesKm,
  distanceBetweenGeometriesMeters,
  distanceToGeometryKm,
  distanceToGeometryMeters,
} from "./distance.ts";
export { regionSimplifier, simplifyRegions, type Region } from "./simplify.ts";
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
