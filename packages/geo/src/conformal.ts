/**
 * Two conformal projections on an ellipsoid: the Transverse Mercator and the Lambert Conformal Conic with two standard
 * parallels. A projection of each kind comes from a definition as data, for example a zone of the State Plane system.
 *
 * - The Transverse Mercator uses the series of Krüger in `n`, the third flattening of the ellipsoid, to the order 6, as Karney (2011)
 *   gives them. Within approximately 3900 km of the central meridian, the error is less than 1 mm.
 * - The Lambert Conformal Conic uses the closed formulas of the EPSG guidance note 7-2 (method 9802). The inverse finds
 *   the latitude by a fixed-point iteration.
 * - The units of the plane are metres. The x axis points east, and the y axis points north.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import { checkEllipsoid, type Ellipsoid } from "./geodesic.ts";
import { checkPoint, latLon, normalizeLon, type LatLon } from "./point.ts";
import type { PlanePoint, Projection, ProjectionScale } from "./projection.ts";

/** The ellipsoid of GRS 1980, the ellipsoid of NAD83: the equatorial radius 6378137 m and the flattening 1/298.257222101. */
export const GRS80: Ellipsoid = Object.freeze({ equatorialRadiusMeters: 6_378_137, flattening: 1 / 298.257222101 });

/** The definition of a Transverse Mercator projection. Each angle is in degrees, and each false value is in metres. */
export interface TransverseMercatorDefinition {
  readonly kind: "transverse-mercator";
  /** The latitude of the natural origin. Its point on the central meridian goes to the false northing. */
  readonly latitudeOfOrigin: number;
  /** The longitude of the central meridian. */
  readonly centralMeridian: number;
  /** The scale factor on the central meridian, a finite number more than 0. */
  readonly scaleFactor: number;
  readonly falseEasting: number;
  readonly falseNorthing: number;
  /** The ellipsoid. The default is `GRS80`. */
  readonly ellipsoid?: Ellipsoid;
}

/**
 * The definition of a Lambert Conformal Conic projection with two standard parallels (EPSG method 9802). Each angle is
 * in degrees, and each false value is in metres. Two equal standard parallels give a cone that touches one parallel.
 */
export interface LambertConformalConicDefinition {
  readonly kind: "lambert-conformal-conic";
  readonly standardParallel1: number;
  readonly standardParallel2: number;
  /** The latitude of the false origin. Its point on the central meridian goes to the false northing. */
  readonly latitudeOfOrigin: number;
  /** The longitude of the false origin: the central meridian. */
  readonly centralMeridian: number;
  readonly falseEasting: number;
  readonly falseNorthing: number;
  /** The ellipsoid. The default is `GRS80`. */
  readonly ellipsoid?: Ellipsoid;
}

/** The definition of a conformal projection: a Transverse Mercator or a Lambert Conformal Conic. */
export type ConformalDefinition = TransverseMercatorDefinition | LambertConformalConicDefinition;

const DEGREE = Math.PI / 180;

function checkPlanePoint(point: PlanePoint): void {
  if (!Number.isFinite(point.x)) throw new GeoError("not-finite", `The x ${point.x} is not a finite number`);
  if (!Number.isFinite(point.y)) throw new GeoError("not-finite", `The y ${point.y} is not a finite number`);
}

function checkFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new GeoError("not-finite", `The ${name} ${value} is not a finite number`);
}

function checkLatitude(value: number, name: string, open: boolean): void {
  checkFinite(value, name);
  if (open ? Math.abs(value) >= 90 : Math.abs(value) > 90) {
    throw new GeoError("latitude-range", `The ${name} ${value} is not ${open ? "more than -90 and less than 90" : "from -90 to 90"}`);
  }
}

/** This function gives the longitude difference `lon - center` in degrees, from -180 to less than 180. */
function lonDifference(lon: number, center: number): number {
  return normalizeLon(lon - center);
}

/** This function gives the tangent of the conformal latitude for the tangent of the latitude (Karney 2011, equation 7). */
function conformalTan(tau: number, e: number): number {
  const sigma = Math.sinh(e * Math.atanh((e * tau) / Math.hypot(1, tau)));
  return tau * Math.hypot(1, sigma) - sigma * Math.hypot(1, tau);
}

/** This function gives the tangent of the latitude for the tangent of the conformal latitude, by Newton's method. */
function latitudeTan(tauPrime: number, e: number): number {
  const e2m = 1 - e * e;
  let tau = tauPrime / e2m;
  for (let i = 0; i < 10; i++) {
    const tp = conformalTan(tau, e);
    const step = ((tauPrime - tp) / Math.hypot(1, tp)) * ((1 + e2m * tau * tau) / (e2m * Math.hypot(1, tau)));
    tau += step;
    if (Math.abs(step) <= 1e-15 * Math.max(1, Math.abs(tau))) break;
  }
  return tau;
}

/** The coefficients of the series of Krüger in `n`, the third flattening of the ellipsoid (Karney 2011, equations 35 and 36). */
function krugerSeries(n: number): { readonly alpha: readonly number[]; readonly beta: readonly number[]; readonly rectifying: number } {
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;
  const n5 = n4 * n;
  const n6 = n5 * n;
  const alpha = [
    n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180 - (127 * n5) / 288 + (7891 * n6) / 37800,
    (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440 + (281 * n5) / 630 - (1983433 * n6) / 1935360,
    (61 * n3) / 240 - (103 * n4) / 140 + (15061 * n5) / 26880 + (167603 * n6) / 181440,
    (49561 * n4) / 161280 - (179 * n5) / 168 + (6601661 * n6) / 7257600,
    (34729 * n5) / 80640 - (3418889 * n6) / 1995840,
    (212378941 * n6) / 319334400,
  ];
  const beta = [
    n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360 - (81 * n5) / 512 + (96199 * n6) / 604800,
    n2 / 48 + n3 / 15 - (437 * n4) / 1440 + (46 * n5) / 105 - (1118711 * n6) / 3870720,
    (17 * n3) / 480 - (37 * n4) / 840 - (209 * n5) / 4480 + (5569 * n6) / 90720,
    (4397 * n4) / 161280 - (11 * n5) / 504 - (830251 * n6) / 7257600,
    (4583 * n5) / 161280 - (108847 * n6) / 3991680,
    (20648693 * n6) / 638668800,
  ];
  return { alpha, beta, rectifying: (1 + n2 / 4 + n4 / 64 + n6 / 256) / (1 + n) };
}

/**
 * This function gives the Transverse Mercator projection of a definition.
 *
 * - `toPlane` and `scale` accept each point with a latitude from -90 to 90. Far from the central meridian, the error
 *   increases. A longitude difference of 90 degrees or more on the equator has no finite point.
 * - `fromPlane` accepts each finite point. The longitude of its result is normalized.
 * - The projection is conformal, so `scale` gives one factor: `min` is equal to `max`.
 *
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `projection`.
 */
export function transverseMercator(definition: TransverseMercatorDefinition): Projection {
  const ellipsoid = definition.ellipsoid ?? GRS80;
  checkEllipsoid(ellipsoid);
  checkLatitude(definition.latitudeOfOrigin, "latitude of origin", false);
  checkFinite(definition.centralMeridian, "central meridian");
  checkFinite(definition.falseEasting, "false easting");
  checkFinite(definition.falseNorthing, "false northing");
  if (!(Number.isFinite(definition.scaleFactor) && definition.scaleFactor > 0)) {
    throw new GeoError("projection", `The scale factor ${definition.scaleFactor} is not a finite number more than 0`);
  }
  if (!(ellipsoid.flattening >= 0)) throw new GeoError("projection", `The flattening ${ellipsoid.flattening} of a Transverse Mercator is less than 0`);
  const a = ellipsoid.equatorialRadiusMeters;
  const f = ellipsoid.flattening;
  const e = Math.sqrt(f * (2 - f));
  const n = f / (2 - f);
  const { alpha, beta, rectifying } = krugerSeries(n);
  const k0 = definition.scaleFactor;
  const radius = a * rectifying;
  const lon0 = definition.centralMeridian;

  /** The series values at a point: the Gauss-Krüger coordinates and the complex derivative for the scale. */
  const forward = (lat: number, dLon: number): { xi: number; eta: number; p: number; q: number; tau: number; tauPrime: number } => {
    const phi = lat * DEGREE;
    const lambda = dLon * DEGREE;
    const tau = Math.abs(lat) === 90 ? Math.sign(lat) * Number.POSITIVE_INFINITY : Math.tan(phi);
    const tauPrime = Number.isFinite(tau) ? conformalTan(tau, e) : tau;
    const cosLambda = Math.cos(lambda);
    const xiPrime = Number.isFinite(tauPrime) ? Math.atan2(tauPrime, cosLambda) : Math.sign(tauPrime) * (Math.PI / 2);
    const etaPrime = Number.isFinite(tauPrime) ? Math.asinh(Math.sin(lambda) / Math.hypot(tauPrime, cosLambda)) : 0;
    let xi = xiPrime;
    let eta = etaPrime;
    let p = 1;
    let q = 0;
    for (let j = 1; j <= 6; j++) {
      const c = alpha[j - 1]!;
      const s2 = Math.sin(2 * j * xiPrime);
      const c2 = Math.cos(2 * j * xiPrime);
      const ch = Math.cosh(2 * j * etaPrime);
      const sh = Math.sinh(2 * j * etaPrime);
      xi += c * s2 * ch;
      eta += c * c2 * sh;
      p += 2 * j * c * c2 * ch;
      q += 2 * j * c * s2 * sh;
    }
    return { xi, eta, p, q, tau, tauPrime };
  };
  const northingOfOrigin = k0 * radius * forward(definition.latitudeOfOrigin, 0).xi;

  const checkInput = (point: LatLon): number => {
    checkPoint(point);
    const dLon = lonDifference(point.lon, lon0);
    if (Math.abs(dLon) >= 90 && point.lat === 0) {
      throw new GeoError("projection", `The point ${point.lat}, ${point.lon} is 90 degrees or more from the central meridian on the equator`);
    }
    return dLon;
  };

  return Object.freeze({
    name: "Transverse Mercator",
    toPlane(point: LatLon): PlanePoint {
      const dLon = checkInput(point);
      const { xi, eta } = forward(point.lat, dLon);
      return { x: definition.falseEasting + k0 * radius * eta + 0, y: definition.falseNorthing + k0 * radius * xi - northingOfOrigin + 0 };
    },
    fromPlane(point: PlanePoint): LatLon {
      checkPlanePoint(point);
      const xi = (point.y - definition.falseNorthing + northingOfOrigin) / (k0 * radius);
      const eta = (point.x - definition.falseEasting) / (k0 * radius);
      let xiPrime = xi;
      let etaPrime = eta;
      for (let j = 1; j <= 6; j++) {
        const c = beta[j - 1]!;
        xiPrime -= c * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        etaPrime -= c * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      }
      const sinhEta = Math.sinh(etaPrime);
      const cosXi = Math.cos(xiPrime);
      const r = Math.hypot(sinhEta, cosXi);
      const lambda = r === 0 ? 0 : Math.atan2(sinhEta, cosXi);
      const tauPrime = Math.sin(xiPrime) / r;
      const lat = r === 0 ? Math.sign(xiPrime) * 90 : Math.atan(latitudeTan(tauPrime, e)) / DEGREE;
      return latLon(lat + 0, lon0 + lambda / DEGREE);
    },
    scale(point: LatLon): ProjectionScale {
      const dLon = checkInput(point);
      if (Math.abs(point.lat) === 90) {
        // At a pole, the scale is the limit of the scale on the meridian. The ratio of tau to the conformal tau goes to exp(e atanh(e)).
        const k = k0 * rectifying * forward(point.lat, 0).p * Math.sqrt(1 - e * e) * Math.exp(e * Math.atanh(e));
        return { max: k, min: k };
      }
      const { p, q, tau, tauPrime } = forward(point.lat, dLon);
      const phi = point.lat * DEGREE;
      const cosLambda = Math.cos(dLon * DEGREE);
      // Karney (2011), equation 25: the scale of the Gauss-Schreiber step times the scale of the series.
      const k = k0 * rectifying * Math.sqrt(1 - e * e * Math.sin(phi) ** 2) * (Math.hypot(1, tau) / Math.hypot(tauPrime, cosLambda)) * Math.hypot(p, q);
      return { max: k, min: k };
    },
  });
}

/**
 * This function gives the Lambert Conformal Conic projection of a definition with two standard parallels.
 *
 * - The two standard parallels are on the same side of the equator, and neither is a pole. Two standard parallels that
 *   are symmetric about the equator give no cone, and get the code `projection`.
 * - `toPlane` and `scale` refuse the pole at the apex of the cone and the opposite pole, with the code `latitude-range`.
 * - `fromPlane` accepts each finite point. The longitude of its result is normalized.
 * - The scale is 1 on each standard parallel. The projection is conformal, so `min` is equal to `max`.
 *
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `projection`.
 */
export function lambertConformalConic(definition: LambertConformalConicDefinition): Projection {
  const ellipsoid = definition.ellipsoid ?? GRS80;
  checkEllipsoid(ellipsoid);
  checkLatitude(definition.standardParallel1, "first standard parallel", true);
  checkLatitude(definition.standardParallel2, "second standard parallel", true);
  checkLatitude(definition.latitudeOfOrigin, "latitude of origin", true);
  checkFinite(definition.centralMeridian, "central meridian");
  checkFinite(definition.falseEasting, "false easting");
  checkFinite(definition.falseNorthing, "false northing");
  const a = ellipsoid.equatorialRadiusMeters;
  const f = ellipsoid.flattening;
  if (!(f >= 0)) throw new GeoError("projection", `The flattening ${f} of a Lambert Conformal Conic is less than 0`);
  const e = Math.sqrt(f * (2 - f));
  const mOf = (phi: number): number => Math.cos(phi) / Math.sqrt(1 - e * e * Math.sin(phi) ** 2);
  const tOf = (phi: number): number => {
    const s = e * Math.sin(phi);
    return Math.tan(Math.PI / 4 - phi / 2) / ((1 - s) / (1 + s)) ** (e / 2);
  };
  const phi1 = definition.standardParallel1 * DEGREE;
  const phi2 = definition.standardParallel2 * DEGREE;
  const m1 = mOf(phi1);
  const t1 = tOf(phi1);
  const n = phi1 === phi2 ? Math.sin(phi1) : (Math.log(mOf(phi1)) - Math.log(mOf(phi2))) / (Math.log(t1) - Math.log(tOf(phi2)));
  if (!(Number.isFinite(n) && Math.abs(n) > 1e-12)) {
    throw new GeoError("projection", `The standard parallels ${definition.standardParallel1} and ${definition.standardParallel2} give no cone`);
  }
  const big = m1 / (n * t1 ** n);
  const rOf = (phi: number): number => a * big * tOf(phi) ** n;
  const rOrigin = rOf(definition.latitudeOfOrigin * DEGREE);
  const lon0 = definition.centralMeridian;

  const checkInput = (point: LatLon): void => {
    checkPoint(point);
    if (Math.abs(point.lat) === 90) throw new GeoError("latitude-range", `The latitude ${point.lat} is a pole, which has no point on this cone`);
  };

  return Object.freeze({
    name: "Lambert Conformal Conic",
    toPlane(point: LatLon): PlanePoint {
      checkInput(point);
      const r = rOf(point.lat * DEGREE);
      const theta = n * lonDifference(point.lon, lon0) * DEGREE;
      return { x: definition.falseEasting + r * Math.sin(theta) + 0, y: definition.falseNorthing + rOrigin - r * Math.cos(theta) + 0 };
    },
    fromPlane(point: PlanePoint): LatLon {
      checkPlanePoint(point);
      const dx = point.x - definition.falseEasting;
      const dy = rOrigin - (point.y - definition.falseNorthing);
      const sign = Math.sign(n);
      const r = sign * Math.hypot(dx, dy);
      const theta = Math.atan2(sign * dx, sign * dy);
      if (r === 0) return latLon(sign * 90, lon0);
      const t = (r / (a * big)) ** (1 / n);
      let phi = Math.PI / 2 - 2 * Math.atan(t);
      for (let i = 0; i < 20; i++) {
        const s = e * Math.sin(phi);
        const next = Math.PI / 2 - 2 * Math.atan(t * ((1 - s) / (1 + s)) ** (e / 2));
        const done = Math.abs(next - phi) <= 1e-15;
        phi = next;
        if (done) break;
      }
      return latLon(phi / DEGREE + 0, lon0 + theta / n / DEGREE);
    },
    scale(point: LatLon): ProjectionScale {
      checkInput(point);
      const phi = point.lat * DEGREE;
      const k = (n * rOf(phi)) / (a * mOf(phi));
      return { max: k, min: k };
    },
  });
}

/** This function gives the projection of a conformal definition: a Transverse Mercator or a Lambert Conformal Conic. */
export function conformalProjection(definition: ConformalDefinition): Projection {
  return definition.kind === "transverse-mercator" ? transverseMercator(definition) : lambertConformalConic(definition);
}
