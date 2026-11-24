/**
 * This module gives the place of the sun at an instant. It also gives the sunrise, the solar noon and the sunset at a point on a date.
 *
 * The sources of the method:
 *
 * - The place of the sun: the low-precision formulas of The Astronomical Almanac (U.S. Naval Observatory and H.M.
 *   Nautical Almanac Office), as the Wikipedia page "Position of the Sun" gives them (revision 1386341289, CC BY-SA
 *   4.0). The page gives a precision of approximately 0.01 degree for the dates from 1950 to 2050.
 * - The equation of time: the mean sun has the right ascension `L`, the mean longitude, by definition. Thus the equation
 *   of time (apparent time minus mean time) is `L - α`, at 4 minutes for each degree.
 * - The sunrise and the sunset: the hour angle of the generalized equation of the Wikipedia page "Sunrise equation"
 *   (revision 1379585755, after Meeus, Astronomical Algorithms). The center of the sun is at the altitude -0.833 degree:
 *   the refraction of the air and the semidiameter of the sun.
 * - The equation has no solution when the cosine of the hour angle is not from -1 to 1. Then the day is a polar day or a polar night.
 *
 * The limits:
 *
 * - The formulas take Terrestrial Time. The functions give Universal Time in their place. The difference of approximately
 *   70 s changes the declination by less than 0.001 degree.
 * - The refraction changes with the temperature and the pressure of the air. Thus a real sunrise can differ by approximately 2 minutes.
 * - The functions do not correct for the height of the observer or for the shape of the horizon.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import { checkPoint, normalizeLon, type LatLon } from "./point.ts";

/** The altitude of the center of the sun at sunrise and at sunset, in degrees: the refraction and the semidiameter. */
export const SUNRISE_ALTITUDE_DEG = -0.833;

/** The milliseconds in one day. */
const DAY_MS = 86_400_000;
/** The milliseconds in one hour. */
const HOUR_MS = 3_600_000;
/** The Julian date of the Unix epoch, 1970-01-01T00:00Z. */
const UNIX_EPOCH_JD = 2_440_587.5;
/** The Julian date of J2000.0, 2000-01-01T12:00 Terrestrial Time. */
const J2000_JD = 2_451_545;
/** The count of the steps that bring a sunrise or a sunset to the declination at its own instant. */
const STEPS = 4;

const RAD = Math.PI / 180;

/** The place of the sun at an instant. */
export interface SunPosition {
  /** The declination, in degrees. It is from approximately -23.44 to 23.44. */
  readonly declinationDeg: number;
  /** The right ascension, in degrees from 0 to less than 360. */
  readonly rightAscensionDeg: number;
  /** The equation of time: the apparent solar time minus the mean solar time, in minutes. */
  readonly equationOfTimeMin: number;
}

/**
 * The sun on one date at one point. The times are instants in milliseconds from the Unix epoch.
 *
 * - `rise-set`: the sun rises and sets on the date.
 * - `polar-day`: the center of the sun stays above the altitude of the sunrise for the full day.
 * - `polar-night`: the center of the sun stays below that altitude for the full day.
 */
export type SunDay =
  | { readonly kind: "rise-set"; readonly rise: number; readonly noon: number; readonly set: number; readonly daylightHours: number }
  | { readonly kind: "polar-day"; readonly noon: number; readonly daylightHours: 24 }
  | { readonly kind: "polar-night"; readonly noon: number; readonly daylightHours: 0 };

/** The options of `sunDay`. */
export interface SunDayOptions {
  /**
   * The altitude of the center of the sun at sunrise and at sunset, in degrees from -90 to 90. The default is
   * `SUNRISE_ALTITUDE_DEG`. For example, -6 gives the start and the end of civil twilight.
   */
  readonly altitudeDeg?: number | undefined;
}

/** This function gives an angle in degrees from 0 to less than 360. */
function turn(deg: number): number {
  const out = deg % 360;
  return out < 0 ? out + 360 : out;
}

/**
 * This function gives the place of the sun at an instant, with the low-precision formulas of The Astronomical Almanac.
 *
 * @param at - The instant, in milliseconds from the Unix epoch
 * @throws GeoError - The code is `not-finite` for an instant that is not a finite number.
 */
export function sunPosition(at: number): SunPosition {
  if (!Number.isFinite(at)) throw new GeoError("not-finite", `The instant ${at} is not a finite number`);
  const n = at / DAY_MS + UNIX_EPOCH_JD - J2000_JD;
  const meanLongitude = turn(280.46 + 0.9856474 * n);
  const g = turn(357.528 + 0.9856003 * n) * RAD;
  const lambda = (meanLongitude + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const epsilon = (23.439 - 0.0000004 * n) * RAD;
  const rightAscensionDeg = turn(Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) / RAD);
  const declinationDeg = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) / RAD;
  // The difference of the two angles is near 0. Bring it to the range from -180 to 180 degrees.
  const lead = turn(meanLongitude - rightAscensionDeg + 180) - 180;
  return { declinationDeg, rightAscensionDeg, equationOfTimeMin: 4 * lead };
}

/** This function gives the instant of the start of a date `YYYY-MM-DD` in UTC, or `undefined` for an incorrect date. */
function dayStart(date: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = Date.UTC(year, month - 1, day);
  const back = new Date(at);
  return back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day ? at : undefined;
}

/**
 * This function gives the cosine of the hour angle of the sun at an altitude. The value is not from -1 to 1 when
 * the sun does not reach the altitude. At a pole, the value is plus or minus `Infinity`.
 */
function hourCosine(latRad: number, declinationDeg: number, altitudeRad: number): number {
  const delta = declinationDeg * RAD;
  const below = Math.cos(latRad) * Math.cos(delta);
  const top = Math.sin(altitudeRad) - Math.sin(latRad) * Math.sin(delta);
  // At a pole the sun moves on a circle of one altitude: the declination with the sign of the latitude.
  if (Math.abs(below) < 1e-12) return top > 0 ? Infinity : -Infinity;
  return top / below;
}

/**
 * This function gives the sunrise, the solar noon and the sunset at a point on a date, or a polar day or night.
 *
 * The date is the date of the mean solar time of the point. Thus its solar noon is near 12:00 UTC minus the longitude
 * at 15 degrees for each hour. The function takes the declination and the equation of time at the instant of each
 * event, with four steps for each event. The method has no solution when the sun does not reach the altitude. Then
 * the declination at the solar noon tells a polar day from a polar night.
 *
 * @param point - The point, with a latitude from -90 to 90
 * @param date - The date, `YYYY-MM-DD`
 * @param options - The altitude of the sun at sunrise and sunset
 * @throws GeoError - The code is `not-finite` or `latitude-range` for an incorrect point. The code is `date` for an
 *   incorrect date, and `altitude` for an altitude that is not a finite number from -90 to 90.
 */
export function sunDay(point: LatLon, date: string, options: SunDayOptions = {}): SunDay {
  checkPoint(point);
  const start = typeof date === "string" ? dayStart(date) : undefined;
  if (start === undefined) throw new GeoError("date", `The date ${String(date)} is not a date YYYY-MM-DD`);
  const altitudeDeg = options.altitudeDeg ?? SUNRISE_ALTITUDE_DEG;
  if (!Number.isFinite(altitudeDeg) || altitudeDeg < -90 || altitudeDeg > 90)
    throw new GeoError("altitude", `The altitude ${altitudeDeg} of the sun is not a finite number from -90 to 90`);
  const latRad = point.lat * RAD;
  const altitudeRad = altitudeDeg * RAD;
  // The mean solar noon of the point. The apparent solar noon is earlier by the equation of time.
  const meanNoon = start + DAY_MS / 2 - (normalizeLon(point.lon) / 15) * HOUR_MS;
  let noon = meanNoon;
  for (let step = 0; step < STEPS; step++) noon = meanNoon - sunPosition(noon).equationOfTimeMin * 60_000;
  const atNoon = hourCosine(latRad, sunPosition(noon).declinationDeg, altitudeRad);
  if (atNoon < -1) return { kind: "polar-day", noon, daylightHours: 24 };
  if (atNoon > 1) return { kind: "polar-night", noon, daylightHours: 0 };
  // One event: the sunrise has the sign -1, and the sunset has the sign 1.
  const event = (sign: -1 | 1): number => {
    let at = noon;
    for (let step = 0; step < STEPS; step++) {
      const sun = sunPosition(at);
      const cosine = Math.min(1, Math.max(-1, hourCosine(latRad, sun.declinationDeg, altitudeRad)));
      const hours = Math.acos(cosine) / RAD / 15;
      at = meanNoon - sun.equationOfTimeMin * 60_000 + sign * hours * HOUR_MS;
    }
    return at;
  };
  const rise = event(-1);
  const set = event(1);
  return { kind: "rise-set", rise, noon, set, daylightHours: (set - rise) / HOUR_MS };
}
