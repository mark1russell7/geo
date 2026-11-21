/**
 * Map projections. A projection changes a point on the Earth to a point on a plane. It also changes a point on the
 * plane back to a point on the Earth.
 *
 * - `WEB_MERCATOR` is the projection of web maps (EPSG:3857). Its plane is the plane of the tiles of OpenStreetMap.
 * - `azimuthalEquidistant` gives a projection for an area around a center. The distance and the bearing from the center
 *   to each point are exact on the ellipsoid.
 * - Each projection gives its scale factors at a point, so a map can show a correct scale bar.
 *
 * The units of the plane are metres. The x axis points east, and the y axis points north.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import { atan2d, checkEllipsoid, geodesicDirect, geodesicInverse, geodesicReducedLength, sincosd, WGS84, type Ellipsoid } from "./geodesic.ts";
import { checkPoint, latLon, normalizeLon, type LatLon } from "./point.ts";

/** A point on the plane of a projection, in metres. The x axis points east, and the y axis points north. */
export interface PlanePoint {
  /** The distance to the east, in metres. */
  readonly x: number;
  /** The distance to the north, in metres. */
  readonly y: number;
}

/**
 * The scale factors of a projection at a point. A scale factor is a length on the plane divided by the same length on
 * the ellipsoid, for a very short line from the point. The value 1 is a true scale.
 */
export interface ProjectionScale {
  /** The largest scale factor at the point, for all the directions of a line. */
  readonly max: number;
  /** The smallest scale factor at the point. For a conformal projection, `min` is equal to `max`. */
  readonly min: number;
}

/** A map projection: three functions on the points of the Earth and of the plane. */
export interface Projection {
  /** The name of the projection, for the legend of a map. */
  readonly name: string;
  /**
   * This function gives the point on the plane for a point on the Earth.
   *
   * @throws GeoError - The code is `not-finite` or `latitude-range`.
   */
  readonly toPlane: (point: LatLon) => PlanePoint;
  /**
   * This function gives the point on the Earth for a point on the plane. The longitude of the result is normalized.
   *
   * @throws GeoError - The code is `not-finite`.
   */
  readonly fromPlane: (point: PlanePoint) => LatLon;
  /**
   * This function gives the scale factors of the projection at a point on the Earth.
   *
   * @throws GeoError - The code is `not-finite` or `latitude-range`.
   */
  readonly scale: (point: LatLon) => ProjectionScale;
}

const DEGREE = Math.PI / 180;

/** The radius of the sphere of Web Mercator: the equatorial radius of WGS84, in metres. */
const MERCATOR_RADIUS = WGS84.equatorialRadiusMeters;

/** The square of the eccentricity of WGS84. */
const E2 = WGS84.flattening * (2 - WGS84.flattening);

/**
 * The largest latitude of Web Mercator in degrees, approximately 85.0511287798066. At this latitude, the plane is a
 * square: `y` is equal to the largest `x`.
 */
export const WEB_MERCATOR_MAX_LATITUDE: number = Math.atan(Math.sinh(Math.PI)) / DEGREE;

/**
 * The largest `x` and `y` of Web Mercator in metres, approximately 20037508.342789244. It is half of the length of the
 * equator.
 */
export const WEB_MERCATOR_MAX_METERS: number = Math.PI * MERCATOR_RADIUS;

/** This function refuses a point that is not finite. */
function checkPlanePoint(point: PlanePoint): void {
  if (!Number.isFinite(point.x)) throw new GeoError("not-finite", `The x ${point.x} is not a finite number`);
  if (!Number.isFinite(point.y)) throw new GeoError("not-finite", `The y ${point.y} is not a finite number`);
}

/** This function refuses a point that is not correct, or that is out of the range of the latitudes of Web Mercator. */
function checkMercatorPoint(point: LatLon): void {
  checkPoint(point);
  if (Math.abs(point.lat) > WEB_MERCATOR_MAX_LATITUDE) {
    throw new GeoError(
      "latitude-range",
      `The latitude ${point.lat} is not from -${WEB_MERCATOR_MAX_LATITUDE} to ${WEB_MERCATOR_MAX_LATITUDE}, the range of Web Mercator`,
    );
  }
}

/**
 * The projection of web maps, EPSG:3857 ("Pseudo-Mercator"). It is the plane of the tiles of OpenStreetMap.
 *
 * - The projection uses the formulas of a sphere with the equatorial radius of WGS84 on the coordinates of WGS84.
 *   Thus it is not conformal on the ellipsoid.
 * - The latitude of a point must be from `-WEB_MERCATOR_MAX_LATITUDE` to `WEB_MERCATOR_MAX_LATITUDE`. A longitude is
 *   normalized first, so the plane goes from `-WEB_MERCATOR_MAX_METERS` to less than `WEB_MERCATOR_MAX_METERS` in x.
 * - `fromPlane` accepts each finite point. An x out of the square gives the same longitude as x plus or minus the length
 *   of the equator. A y out of the square gives a latitude out of the range of `toPlane`.
 * - The scale factors are for the ellipsoid of WGS84. `max` is the scale along the meridian, and `min` is the scale
 *   along the parallel. At the equator, they are approximately 1.0067 and 1. At 60 degrees, they are approximately 2.
 */
export const WEB_MERCATOR: Projection = Object.freeze({
  name: "Web Mercator (EPSG:3857)",
  toPlane(point: LatLon): PlanePoint {
    checkMercatorPoint(point);
    // The factor lon / 180 keeps the edges exact: the longitude -180 gives -WEB_MERCATOR_MAX_METERS with no rounding.
    const x = WEB_MERCATOR_MAX_METERS * (normalizeLon(point.lon) / 180);
    const y = MERCATOR_RADIUS * Math.atanh(Math.sin(point.lat * DEGREE));
    return { x: x + 0, y: y + 0 };
  },
  fromPlane(point: PlanePoint): LatLon {
    checkPlanePoint(point);
    const lat = Math.atan(Math.sinh(point.y / MERCATOR_RADIUS)) / DEGREE;
    return latLon(lat + 0, 180 * (point.x / WEB_MERCATOR_MAX_METERS));
  },
  scale(point: LatLon): ProjectionScale {
    checkMercatorPoint(point);
    const phi = point.lat * DEGREE;
    const w = 1 - E2 * Math.sin(phi) ** 2;
    const cos = Math.cos(phi);
    // The parallel: a / (nu cos(phi)), with nu = a / sqrt(w). The meridian: a sec(phi) / M, with M = a (1 - e2) / w^(3/2).
    const parallel = Math.sqrt(w) / cos;
    const meridian = (w * Math.sqrt(w)) / ((1 - E2) * cos);
    return { max: Math.max(parallel, meridian), min: Math.min(parallel, meridian) };
  },
});

/**
 * This function gives the azimuthal equidistant projection with a center. The projection is good for a map of the area
 * around the center, for example 20 km around a place.
 *
 * - The distance on the plane from the center to a point is the length of the geodesic from the center to that point.
 *   The direction on the plane is the bearing of the geodesic. These two values are exact to the rounding of double
 *   numbers, as `geodesicInverse` gives them.
 * - At the center, the y axis points north. North is not up at a point that is far from the center.
 * - The scale along a geodesic from the center is 1. The scale at right angles to it is `s / m12`, with the reduced
 *   length `m12`. At 20 km from the center, the scale is less than 1.000002. At the antipode of the center, it is infinite.
 * - Near the antipode of the center, more than one geodesic can be the shortest. Then `toPlane` gives one of them.
 * - `fromPlane` accepts each finite point. For a point at the distance `d` from the center, it gives the end of the
 *   geodesic of the length `d`. A value of `d` that is more than half of a meridian is also correct.
 *
 * @param center - The center of the projection. It goes to the point (0, 0) of the plane.
 * @param ellipsoid - The ellipsoid. The default is `WGS84`.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `radius`.
 */
export function azimuthalEquidistant(center: LatLon, ellipsoid: Ellipsoid = WGS84): Projection {
  checkPoint(center);
  checkEllipsoid(ellipsoid);
  const origin = latLon(center.lat, center.lon);
  return Object.freeze({
    name: "Azimuthal equidistant",
    toPlane(point: LatLon): PlanePoint {
      const line = geodesicInverse(origin, point, ellipsoid);
      const direction = sincosd(line.initialBearing);
      return { x: line.meters * direction.s + 0, y: line.meters * direction.c + 0 };
    },
    fromPlane(point: PlanePoint): LatLon {
      checkPlanePoint(point);
      const meters = Math.hypot(point.x, point.y);
      if (meters === 0) return { lat: origin.lat, lon: origin.lon };
      return geodesicDirect(origin, atan2d(point.x, point.y), meters, ellipsoid).point;
    },
    scale(point: LatLon): ProjectionScale {
      const line = geodesicInverse(origin, point, ellipsoid);
      if (line.meters === 0) return { max: 1, min: 1 };
      const reduced = geodesicReducedLength(origin, line.initialBearing, line.meters, ellipsoid);
      // The shortest geodesic does not go past a conjugate point, so its reduced length is not less than 0.
      const across = reduced > 0 ? line.meters / reduced : Number.POSITIVE_INFINITY;
      return { max: Math.max(1, across), min: Math.min(1, across) };
    },
  });
}
