/**
 * This module has the points on the Earth: a latitude and a longitude in degrees on WGS84.
 *
 * @packageDocumentation
 */

import { err, ok, type Result } from "@mark1russell7/optional";
import { GeoError } from "./errors.ts";

/** A point on the Earth: the latitude and the longitude in degrees on WGS84. North and east are positive. */
export interface LatLon {
  /** The latitude in degrees, from -90 to 90. */
  readonly lat: number;
  /** The longitude in degrees. A normalized longitude is from -180 to less than 180. */
  readonly lon: number;
}

/** A GeoJSON position: the longitude first, then the latitude, then an optional altitude. */
export type Position = readonly [lon: number, lat: number, ...rest: number[]];

/**
 * This function gives the longitude in the range from -180 to less than 180. A longitude of 180 becomes -180, and -0
 * becomes 0. The result has no rounding: it is the longitude plus a multiple of 360. So the function does not change a
 * longitude that is already in the range, other than -0.
 *
 * @throws GeoError - The code is `not-finite` for `NaN` or an infinite value.
 */
export function normalizeLon(lon: number): number {
  if (!Number.isFinite(lon)) throw new GeoError("not-finite", `The longitude ${lon} is not a finite number`);
  // The remainder has no rounding. The one step of 360 that follows has no rounding too (the lemma of Sterbenz).
  let result = lon % 360;
  if (result >= 180) result -= 360;
  else if (result < -180) result += 360;
  return result + 0;
}

/**
 * This function examines a latitude and a longitude. It refuses a value that is not finite and a latitude that is not
 * from -90 to 90. It accepts each finite longitude.
 *
 * @internal
 */
export function checkCoordinates(lat: number, lon: number, path: string = ""): void {
  if (!Number.isFinite(lat)) throw new GeoError("not-finite", `The latitude ${lat} is not a finite number`, path);
  if (!Number.isFinite(lon)) throw new GeoError("not-finite", `The longitude ${lon} is not a finite number`, path);
  if (lat < -90 || lat > 90) throw new GeoError("latitude-range", `The latitude ${lat} is not from -90 to 90`, path);
}

/**
 * This function examines a point. It refuses a value that is not finite and a latitude that is not from -90 to 90.
 *
 * @internal
 */
export function checkPoint(point: LatLon, path: string = ""): void {
  checkCoordinates(point.lat, point.lon, path);
}

/**
 * This function gives a point with a normalized longitude.
 *
 * @param lat - The latitude in degrees, from -90 to 90.
 * @param lon - The longitude in degrees. Each finite value is correct.
 * @throws GeoError - The code is `not-finite` or `latitude-range`.
 */
export function latLon(lat: number, lon: number): LatLon {
  checkCoordinates(lat, lon);
  return { lat, lon: normalizeLon(lon) };
}

/**
 * This function reads a point from an unknown value, for example from JSON. The value must be an object with the
 * numbers `lat` and `lon`. The longitude of the result is normalized.
 *
 * @returns The point, or the `GeoError` with the reason of the refusal.
 */
export function parseLatLon(value: unknown): Result<LatLon, GeoError> {
  if (typeof value !== "object" || value === null) {
    return err(new GeoError("not-a-point", "A point must be an object with the numbers lat and lon"));
  }
  const { lat, lon } = value as { readonly lat?: unknown; readonly lon?: unknown };
  if (typeof lat !== "number" || typeof lon !== "number") {
    return err(new GeoError("not-a-point", "A point must be an object with the numbers lat and lon"));
  }
  try {
    return ok(latLon(lat, lon));
  } catch (error) {
    if (error instanceof GeoError) return err(error);
    throw error;
  }
}

/** This function gives the GeoJSON position `[lon, lat]` of a point. */
export function toPosition(point: LatLon): Position {
  return [point.lon, point.lat];
}

/**
 * This function gives the point of a GeoJSON position. It ignores the altitude. The longitude of the result is
 * normalized.
 *
 * @throws GeoError - The code is `position`, `not-finite` or `latitude-range`.
 */
export function fromPosition(position: readonly number[]): LatLon {
  const lon = position[0];
  const lat = position[1];
  if (lon === undefined || lat === undefined) throw new GeoError("position", "A position has two or more numbers");
  return latLon(lat, lon);
}
