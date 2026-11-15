/**
 * The types of GeoJSON (RFC 7946) and a function that examines an unknown value and gives a typed GeoJSON object.
 *
 * @packageDocumentation
 */

import { err, ok, type Result } from "@mark1russell7/optional";
import { GeoError } from "./errors.ts";
import type { Position } from "./point.ts";

/** A GeoJSON bounding box: `[west, south, east, north]`, or `[west, south, low, east, north, high]` with altitudes. */
export type GeoJsonBBox =
  | readonly [west: number, south: number, east: number, north: number]
  | readonly [west: number, south: number, low: number, east: number, north: number, high: number];

/** The members of each GeoJSON object. */
export interface GeoJsonObject {
  /** The bounding box of the object (RFC 7946, section 5). */
  readonly bbox?: GeoJsonBBox;
}

/** A GeoJSON Point: one position. */
export interface Point extends GeoJsonObject {
  readonly type: "Point";
  readonly coordinates: Position;
}

/** A GeoJSON MultiPoint: an array of positions. */
export interface MultiPoint extends GeoJsonObject {
  readonly type: "MultiPoint";
  readonly coordinates: readonly Position[];
}

/** A GeoJSON LineString: two or more positions. An empty array is an empty line. */
export interface LineString extends GeoJsonObject {
  readonly type: "LineString";
  readonly coordinates: readonly Position[];
}

/** A GeoJSON MultiLineString: an array of lines. */
export interface MultiLineString extends GeoJsonObject {
  readonly type: "MultiLineString";
  readonly coordinates: readonly (readonly Position[])[];
}

/**
 * A GeoJSON Polygon: an array of linear rings. The first ring is the exterior, and the other rings are holes. A ring
 * has four or more positions, and its last position is equal to its first position.
 */
export interface Polygon extends GeoJsonObject {
  readonly type: "Polygon";
  readonly coordinates: readonly (readonly Position[])[];
}

/** A GeoJSON MultiPolygon: an array of polygons. */
export interface MultiPolygon extends GeoJsonObject {
  readonly type: "MultiPolygon";
  readonly coordinates: readonly (readonly (readonly Position[])[])[];
}

/** A GeoJSON GeometryCollection: an array of geometries. */
export interface GeometryCollection extends GeoJsonObject {
  readonly type: "GeometryCollection";
  readonly geometries: readonly Geometry[];
}

/** A GeoJSON geometry. */
export type Geometry = Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon | GeometryCollection;

/** The properties of a GeoJSON Feature: a JSON object or `null`. */
export type GeoJsonProperties = { readonly [name: string]: unknown } | null;

/** A GeoJSON Feature: a geometry or `null`, the properties, and an optional identifier. */
export interface Feature<G extends Geometry | null = Geometry | null, P extends GeoJsonProperties = GeoJsonProperties>
  extends GeoJsonObject {
  readonly type: "Feature";
  readonly geometry: G;
  readonly properties: P;
  readonly id?: string | number;
}

/** A GeoJSON FeatureCollection: an array of features. */
export interface FeatureCollection<F extends Feature = Feature> extends GeoJsonObject {
  readonly type: "FeatureCollection";
  readonly features: readonly F[];
}

/** A GeoJSON object: a geometry, a feature or a feature collection. */
export type GeoJson = Geometry | Feature | FeatureCollection;

/** The deepest nesting of collections that `parseGeoJson` accepts. A deeper input gets the code `too-deep`. */
export const MAX_GEOJSON_DEPTH = 32;

type Json = { readonly [name: string]: unknown };

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const memberPath = (path: string, name: string): string => (path === "" ? name : `${path}.${name}`);

/**
 * This function examines a position: an array of two or more finite numbers, with a latitude from -90 to 90. Each
 * finite longitude is correct.
 *
 * @internal
 */
export function checkPosition(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length < 2) {
    throw new GeoError("position", "A position is an array of two or more numbers", path);
  }
  for (const item of value as readonly unknown[]) {
    if (typeof item !== "number") throw new GeoError("position", "A position is an array of two or more numbers", path);
    if (!Number.isFinite(item)) throw new GeoError("not-finite", `The coordinate ${item} is not a finite number`, path);
  }
  const lat = value[1] as number;
  if (lat < -90 || lat > 90) throw new GeoError("latitude-range", `The latitude ${lat} is not from -90 to 90`, path);
}

function checkArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new GeoError("geojson-member", "The value must be an array", path);
  return value as readonly unknown[];
}

function checkPositions(value: unknown, path: string): readonly unknown[] {
  const positions = checkArray(value, path);
  positions.forEach((position, index) => checkPosition(position, `${path}[${index}]`));
  return positions;
}

function checkLine(value: unknown, path: string): void {
  const positions = checkPositions(value, path);
  if (positions.length === 1) throw new GeoError("too-few-positions", "A line has two or more positions", path);
}

/**
 * This function examines a linear ring: four or more positions, and the last position equal to the first position.
 *
 * @internal
 */
export function checkRing(value: unknown, path: string): void {
  const positions = checkPositions(value, path);
  if (positions.length < 4) throw new GeoError("too-few-positions", "A linear ring has four or more positions", path);
  const first = positions[0] as readonly number[];
  const last = positions[positions.length - 1] as readonly number[];
  if (first.length !== last.length || first.some((coordinate, index) => coordinate !== last[index])) {
    throw new GeoError("ring-not-closed", "The last position of a linear ring must be equal to its first position", path);
  }
}

/**
 * This function examines the coordinates of a polygon: an array of linear rings.
 *
 * @internal
 */
export function checkPolygonCoordinates(value: unknown, path: string): void {
  checkArray(value, path).forEach((ring, index) => checkRing(ring, `${path}[${index}]`));
}

/** The edges of a box in degrees. The type `BBox` has this form. */
interface BoxEdges {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * This function examines the edges of a box. It refuses a value that is not finite and a latitude that is not from
 * -90 to 90. It also refuses a south that is more than the north. When `lonRange` is `true`, it refuses a longitude
 * that is not from -180 to 180.
 */
function checkEdges(box: BoxEdges, path: string, lonRange: boolean): void {
  for (const name of ["west", "south", "east", "north"] as const) {
    const value = box[name];
    if (!Number.isFinite(value)) throw new GeoError("not-finite", `The ${name} ${value} of the box is not a finite number`, path);
  }
  if (lonRange && (box.west < -180 || box.west > 180 || box.east < -180 || box.east > 180)) {
    throw new GeoError("longitude-range", "A longitude of the box is not from -180 to 180", path);
  }
  if (box.south < -90 || box.north > 90) throw new GeoError("latitude-range", "A latitude of the box is not from -90 to 90", path);
  if (box.south > box.north) throw new GeoError("bbox", "The south of the box must not be more than its north", path);
}

/**
 * This function examines a box of the type `BBox`. It refuses a value that is not finite, and a longitude that is not
 * from -180 to 180. It also refuses a latitude that is not from -90 to 90, and a south that is more than the north.
 *
 * @internal
 */
export function checkBBox(box: BoxEdges, path: string = ""): void {
  checkEdges(box, path, true);
}

/**
 * This function examines a GeoJSON bounding box: an array of 4 or 6 numbers. It uses the rules of `checkBBox`, but it
 * accepts each finite longitude, as for a position. With 6 numbers, the low altitude must not be more than the high
 * altitude.
 *
 * @internal
 */
export function checkGeoJsonBBox(value: unknown, path: string): void {
  if (!Array.isArray(value) || (value.length !== 4 && value.length !== 6)) {
    throw new GeoError("bbox", "A bounding box is an array of 4 or 6 numbers", path);
  }
  for (const item of value as readonly unknown[]) {
    if (typeof item !== "number") throw new GeoError("bbox", "A bounding box is an array of 4 or 6 numbers", path);
  }
  const numbers = value as readonly number[];
  const half = numbers.length / 2;
  checkEdges(
    { west: numbers[0] as number, south: numbers[1] as number, east: numbers[half] as number, north: numbers[half + 1] as number },
    path,
    false,
  );
  if (half === 3) {
    const low = numbers[2] as number;
    const high = numbers[5] as number;
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      throw new GeoError("not-finite", `The altitudes ${low} and ${high} of the box must be finite numbers`, path);
    }
    if (low > high) throw new GeoError("bbox", "The low altitude of the box must not be more than its high altitude", path);
  }
}

function checkGeometry(value: unknown, path: string, depth: number): void {
  if (!isObject(value)) throw new GeoError("geojson-member", "A geometry must be an object", path);
  const coordinates = memberPath(path, "coordinates");
  switch (value["type"]) {
    case "Point":
      checkPosition(value["coordinates"], coordinates);
      break;
    case "MultiPoint":
      checkPositions(value["coordinates"], coordinates);
      break;
    case "LineString":
      checkLine(value["coordinates"], coordinates);
      break;
    case "MultiLineString":
      checkArray(value["coordinates"], coordinates).forEach((line, index) => checkLine(line, `${coordinates}[${index}]`));
      break;
    case "Polygon":
      checkPolygonCoordinates(value["coordinates"], coordinates);
      break;
    case "MultiPolygon":
      checkArray(value["coordinates"], coordinates).forEach((polygon, index) =>
        checkPolygonCoordinates(polygon, `${coordinates}[${index}]`),
      );
      break;
    case "GeometryCollection": {
      if (depth >= MAX_GEOJSON_DEPTH) throw new GeoError("too-deep", "The collections are nested too deep", path);
      const geometries = memberPath(path, "geometries");
      checkArray(value["geometries"], geometries).forEach((geometry, index) =>
        checkGeometry(geometry, `${geometries}[${index}]`, depth + 1),
      );
      break;
    }
    default:
      throw new GeoError("geojson-type", `The type ${JSON.stringify(value["type"])} is not a GeoJSON geometry`, path);
  }
  if ("bbox" in value) checkGeoJsonBBox(value["bbox"], memberPath(path, "bbox"));
}

function checkFeature(value: Json, path: string, depth: number): void {
  if (!("geometry" in value)) throw new GeoError("geojson-member", "A Feature must have the member geometry", path);
  if (!("properties" in value)) throw new GeoError("geojson-member", "A Feature must have the member properties", path);
  const geometry = value["geometry"];
  if (geometry !== null) checkGeometry(geometry, memberPath(path, "geometry"), depth);
  const properties = value["properties"];
  if (properties !== null && !isObject(properties)) {
    throw new GeoError("geojson-member", "The properties of a Feature must be an object or null", memberPath(path, "properties"));
  }
  if ("id" in value && typeof value["id"] !== "string" && typeof value["id"] !== "number") {
    throw new GeoError("geojson-member", "The id of a Feature must be a string or a number", memberPath(path, "id"));
  }
  if ("bbox" in value) checkGeoJsonBBox(value["bbox"], memberPath(path, "bbox"));
}

function checkGeoJson(value: unknown, path: string): void {
  if (!isObject(value)) throw new GeoError("geojson-member", "A GeoJSON object must be an object", path);
  if (value["type"] === "Feature") {
    checkFeature(value, path, 0);
  } else if (value["type"] === "FeatureCollection") {
    const features = memberPath(path, "features");
    checkArray(value["features"], features).forEach((feature, index) => {
      const featurePath = `${features}[${index}]`;
      if (!isObject(feature) || feature["type"] !== "Feature") {
        throw new GeoError("geojson-type", "Each member of features must be a Feature", featurePath);
      }
      checkFeature(feature, featurePath, 0);
    });
    if ("bbox" in value) checkGeoJsonBBox(value["bbox"], memberPath(path, "bbox"));
  } else {
    checkGeometry(value, path, 0);
  }
}

function attempt<T>(value: unknown, check: (value: unknown) => void): Result<T, GeoError> {
  try {
    check(value);
    return ok(value as T);
  } catch (error) {
    if (error instanceof GeoError) return err(error);
    throw error;
  }
}

/**
 * This function examines an unknown value, for example the result of `JSON.parse`, against RFC 7946. It gives the
 * input object itself with its GeoJSON type. It does not copy the object, and it keeps the foreign members.
 *
 * The rules:
 *
 * - A position has two or more finite numbers. Its latitude is from -90 to 90. Each finite longitude is correct.
 * - A LineString has two or more positions, or no position.
 * - A linear ring has four or more positions, and its last position is equal to its first position. The function
 *   refuses a ring that is not closed. It does not examine the winding of a ring (RFC 7946, section 3.1.6).
 * - A Feature has the members `geometry` (a geometry or `null`) and `properties` (an object or `null`).
 * - A bounding box has 4 or 6 finite numbers. Each finite longitude is correct, as for a position. Its latitudes are
 *   from -90 to 90, and its south is not more than its north. With 6 numbers, its low altitude is not more than its
 *   high altitude. `fromGeoJsonBBox` gives the box with longitudes from -180 to 180.
 *
 * @returns The typed object, or the `GeoError` with the reason and the path of the first incorrect value.
 */
export function parseGeoJson(value: unknown): Result<GeoJson, GeoError> {
  return attempt<GeoJson>(value, (input) => checkGeoJson(input, ""));
}

/**
 * This function examines an unknown value against the rules of a GeoJSON geometry. It refuses a Feature and a
 * FeatureCollection. The rules are the rules of `parseGeoJson`.
 *
 * @returns The typed geometry, or the `GeoError` with the reason and the path of the first incorrect value.
 */
export function parseGeometry(value: unknown): Result<Geometry, GeoError> {
  return attempt<Geometry>(value, (input) => checkGeometry(input, "", 0));
}
