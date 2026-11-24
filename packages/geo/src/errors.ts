/**
 * The error of this package. Each refusal has a code, so a caller can test the reason without the text of the message.
 *
 * @packageDocumentation
 */

/**
 * The reason of a refusal.
 *
 * - `not-finite`: a number is `NaN` or infinite.
 * - `latitude-range`: a latitude is not from -90 to 90. Or a latitude is out of the range of a projection, for example
 *   more than `WEB_MERCATOR_MAX_LATITUDE` for Web Mercator.
 * - `longitude-range`: a longitude of a box is not from -180 to 180. Or a longitude of a polygon in a test is not from
 *   -540 to 540 (`MAX_GEOMETRY_LONGITUDE`).
 * - `not-a-point`: a value is not an object with the numbers `lat` and `lon`.
 * - `geojson-type`: a GeoJSON object has no known `type`.
 * - `geojson-member`: a GeoJSON member is missing or has the wrong type.
 * - `position`: a position is not an array of two or more numbers.
 * - `too-few-positions`: a line has fewer than 2 positions, or a ring has fewer than 4.
 * - `ring-not-closed`: the last position of a ring is not equal to its first position.
 * - `too-deep`: the collections are nested deeper than `MAX_GEOJSON_DEPTH`.
 * - `bbox`: a bounding box has the wrong length, or its south is more than its north.
 * - `geohash-precision`: a precision is not an integer from 1 to 12.
 * - `geohash-length`: a geohash has no character or more than 12 characters.
 * - `geohash-character`: a geohash has a character that is not in its alphabet.
 * - `too-many-cells`: a cover of a box or a buffer needs more cells than the limit.
 * - `max-cells`: the limit of the cells of a cover is `NaN` or less than 0. Or the limit of a buffer is less than 1.
 * - `radius`: the radius of a sphere or of a circle, or the distance of a buffer, is not more than 0. Or the equatorial radius of an ellipsoid is
 *   not more than 0, or its polar radius is not a finite number more than 0.
 * - `tolerance`: a tolerance is less than 0. Or the tolerance of a buffer is not more than 0 or not less than its distance.
 *   Or `minLegMeters` of `routeSteps` is not a finite number from 0.
 * - `vertices`: the number of the vertices of a circle is not an integer from 3 to `MAX_CIRCLE_VERTICES`.
 * - `vector`: a vector has the length 0, so it has no direction.
 * - `step`: the largest step of `densify` is not more than 0. Or the step is too small: the function adds more than
 *   `MAX_DENSIFY_POSITIONS` positions.
 * - `travel-mode`: a travel mode is not a name of `TRAVEL_MODES`, or its table is incorrect.
 * - `route`: a route has no edges, an index that is not an edge of the graph, or two edges that do not join.
 */
export type GeoErrorCode =
  | "not-finite"
  | "latitude-range"
  | "longitude-range"
  | "not-a-point"
  | "geojson-type"
  | "geojson-member"
  | "position"
  | "too-few-positions"
  | "ring-not-closed"
  | "too-deep"
  | "bbox"
  | "geohash-precision"
  | "geohash-length"
  | "geohash-character"
  | "too-many-cells"
  | "max-cells"
  | "radius"
  | "tolerance"
  | "vertices"
  | "vector"
  | "step"
  | "travel-mode"
  | "route";

/**
 * The error that each function of this package throws for an incorrect input. It is a `RangeError`, so code that
 * catches a `RangeError` also catches it.
 */
export class GeoError extends RangeError {
  /** The reason of the refusal. */
  readonly code: GeoErrorCode;
  /** The location of the incorrect value in the input, for example `features[2].geometry`. The root is `""`. */
  readonly path: string;

  /**
   * @param code - The reason of the refusal.
   * @param message - The text for a person.
   * @param path - The location of the incorrect value in the input.
   */
  constructor(code: GeoErrorCode, message: string, path: string = "") {
    super(path === "" ? message : `${path}: ${message}`);
    this.name = "GeoError";
    this.code = code;
    this.path = path;
  }
}
