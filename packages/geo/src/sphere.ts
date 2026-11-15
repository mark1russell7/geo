/**
 * Distances, bearings and destinations on a sphere with the mean radius of the Earth.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import { checkPoint, latLon, normalizeLon, type LatLon } from "./point.ts";

/** The mean radius of the Earth in kilometres: the value `R1` of the IUGG, `(2a + b) / 3` of WGS84. */
export const EARTH_MEAN_RADIUS_KM = 6371.0088;

/** The mean radius of the Earth in metres. It is equal to `EARTH_MEAN_RADIUS_KM` times 1000. */
export const EARTH_MEAN_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

function checkFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new GeoError("not-finite", `The ${name} ${value} is not a finite number`);
}

/**
 * This function refuses a radius that is not finite or not more than 0.
 *
 * @internal
 */
export function checkRadius(value: number): void {
  checkFinite(value, "radius");
  if (value <= 0) throw new GeoError("radius", `The radius ${value} must be more than 0`);
}

/**
 * This function gives the angle between two points at the center of the sphere, in radians from 0 to pi. It uses the
 * haversine formula. The result is the same when the two points change places.
 *
 * @throws GeoError - The code is `not-finite` or `latitude-range`.
 */
export function centralAngleRadians(a: LatLon, b: LatLon): number {
  checkPoint(a);
  checkPoint(b);
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  // For two antipodal points, a rounding error can make h a little more than 1, and the asin of that is NaN.
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * This function gives the great-circle distance between two points in kilometres. The model is a sphere. On the
 * ellipsoid of WGS84, the true distance can be different by up to approximately 0.6 %.
 *
 * @param radiusKm - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_KM`.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `radius`.
 */
export function distanceKm(a: LatLon, b: LatLon, radiusKm: number = EARTH_MEAN_RADIUS_KM): number {
  checkRadius(radiusKm);
  return centralAngleRadians(a, b) * radiusKm;
}

/**
 * This function gives the great-circle distance between two points in metres. The model is a sphere.
 *
 * @param radiusMeters - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_METERS`.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `radius`.
 */
export function distanceMeters(a: LatLon, b: LatLon, radiusMeters: number = EARTH_MEAN_RADIUS_METERS): number {
  checkRadius(radiusMeters);
  return centralAngleRadians(a, b) * radiusMeters;
}

/**
 * This function gives the initial bearing of the great circle from `from` to `to`, in degrees clockwise from north.
 * The result is from 0 to less than 360.
 *
 * - For two equal points, the result is 0. Two longitudes that are different by a multiple of 360 are equal, and all
 *   the longitudes of a pole are one point.
 * - At a pole, each direction is south or north. Then the bearing is measured from the meridian of `from.lon`, as
 *   the limit of the bearing along that meridian. `destinationKm` uses the same rule.
 *
 * @throws GeoError - The code is `not-finite` or `latitude-range`.
 */
export function initialBearing(from: LatLon, to: LatLon): number {
  checkPoint(from);
  checkPoint(to);
  if (from.lat === to.lat && (Math.abs(from.lat) === 90 || normalizeLon(from.lon) === normalizeLon(to.lon))) return 0;
  const phi1 = toRadians(from.lat);
  const phi2 = toRadians(to.lat);
  const dLon = toRadians(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  if (x === 0 && y === 0) return 0;
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * This function gives the point at a central angle from a start point, along the great circle with a bearing. It uses
 * unit vectors, so it is correct at the poles and for each angle.
 *
 * @internal
 */
function destinationByAngle(from: LatLon, bearingDegrees: number, angle: number): LatLon {
  checkPoint(from);
  checkFinite(bearingDegrees, "bearing");
  checkFinite(angle, "distance");
  const phi = toRadians(from.lat);
  const lambda = toRadians(from.lon);
  const theta = toRadians(bearingDegrees);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinLambda = Math.sin(lambda);
  const cosLambda = Math.cos(lambda);
  // The start point p, and the unit vectors to the north and to the east at p.
  const px = cosPhi * cosLambda;
  const py = cosPhi * sinLambda;
  const pz = sinPhi;
  const dx = -sinPhi * cosLambda * Math.cos(theta) - sinLambda * Math.sin(theta);
  const dy = -sinPhi * sinLambda * Math.cos(theta) + cosLambda * Math.sin(theta);
  const dz = cosPhi * Math.cos(theta);
  const cosAngle = Math.cos(angle);
  const sinAngle = Math.sin(angle);
  const qx = px * cosAngle + dx * sinAngle;
  const qy = py * cosAngle + dy * sinAngle;
  const qz = pz * cosAngle + dz * sinAngle;
  const lat = toDegrees(Math.atan2(qz, Math.hypot(qx, qy)));
  const lon = toDegrees(Math.atan2(qy, qx));
  return latLon(Math.max(-90, Math.min(90, lat)), lon);
}

/**
 * This function gives the point at a distance from a start point, along the great circle with an initial bearing. The
 * longitude of the result is normalized. A negative distance goes in the opposite direction.
 *
 * @param bearingDegrees - The initial bearing in degrees clockwise from north.
 * @param distance - The distance in kilometres.
 * @param radiusKm - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_KM`.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `radius`.
 */
export function destinationKm(
  from: LatLon,
  bearingDegrees: number,
  distance: number,
  radiusKm: number = EARTH_MEAN_RADIUS_KM,
): LatLon {
  checkRadius(radiusKm);
  return destinationByAngle(from, bearingDegrees, distance / radiusKm);
}

/**
 * This function gives the point at a distance in metres from a start point, along the great circle with an initial
 * bearing. The longitude of the result is normalized.
 *
 * @param bearingDegrees - The initial bearing in degrees clockwise from north.
 * @param distance - The distance in metres.
 * @param radiusMeters - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_METERS`.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `radius`.
 */
export function destinationMeters(
  from: LatLon,
  bearingDegrees: number,
  distance: number,
  radiusMeters: number = EARTH_MEAN_RADIUS_METERS,
): LatLon {
  checkRadius(radiusMeters);
  return destinationByAngle(from, bearingDegrees, distance / radiusMeters);
}
