/**
 * The zones of the State Plane Coordinate System of 1983 (SPCS 83) as data, and the units of their planes.
 *
 * - Each zone has its NAD83 definition: a Transverse Mercator or a Lambert Conformal Conic on GRS 1980, with the false
 *   values in metres. The zone parameters come from the NGS manual NOAA Manual NOS NGS 5 and the EPSG dataset.
 * - A zone can give its plane in metres, US survey feet or international feet. A survey foot is 1200/3937 m.
 * - The latitude and the longitude are on NAD83. In the contiguous states, NAD83 and WGS84 differ by approximately 1 to 2 m.
 *
 * @packageDocumentation
 */

import { conformalProjection, type ConformalDefinition } from "./conformal.ts";
import { GeoError } from "./errors.ts";
import type { LatLon } from "./point.ts";
import type { PlanePoint, Projection } from "./projection.ts";

/** A unit of length of a plane. */
export type PlaneUnit = "meter" | "us-survey-foot" | "international-foot";

/** The length of each unit of a plane, in metres. The US survey foot is 1200/3937 m, the international foot 0.3048 m. */
export const PLANE_UNIT_METERS: Readonly<Record<PlaneUnit, number>> = Object.freeze({
  meter: 1,
  "us-survey-foot": 1200 / 3937,
  "international-foot": 0.3048,
});

/** A zone of the State Plane Coordinate System of 1983. */
export interface StatePlaneZone {
  /** The four digits of the zone in the SPCS 83 list (the FIPS zone code), for example `"3102"`. */
  readonly fips: string;
  /** The name of the zone, for example `"New York Central"`. */
  readonly name: string;
  /** The two letters of the state, for example `"NY"`. */
  readonly state: string;
  /** The EPSG code of the zone on NAD83 in metres. */
  readonly epsg: number;
  /** The EPSG code of the zone on NAD83 in US survey feet, or `null` when this list gives no such code. */
  readonly epsgUsFeet: number | null;
  /** The definition of the projection, with the false values in metres. */
  readonly definition: ConformalDefinition;
}

/** This function changes degrees, minutes and seconds to degrees. A negative degree value gives a negative angle. */
const dms = (degrees: number, minutes: number, seconds = 0): number => Math.sign(degrees || 1) * (Math.abs(degrees) + minutes / 60 + seconds / 3600);

const tm = (lat0: number, lon0: number, k: number, falseEasting: number, falseNorthing = 0): ConformalDefinition => ({
  kind: "transverse-mercator",
  latitudeOfOrigin: lat0,
  centralMeridian: lon0,
  scaleFactor: k,
  falseEasting,
  falseNorthing,
});

const lcc = (lat1: number, lat2: number, lat0: number, lon0: number, falseEasting: number, falseNorthing = 0): ConformalDefinition => ({
  kind: "lambert-conformal-conic",
  standardParallel1: lat1,
  standardParallel2: lat2,
  latitudeOfOrigin: lat0,
  centralMeridian: lon0,
  falseEasting,
  falseNorthing,
});

/**
 * The zones of this list: New York, Vermont, New Hampshire and Maine. Each zone has the parameters of SPCS 83.
 * A scale factor of the form 1 - 1/m is the exact value of the manual, for example 0.9999375 for 1 - 1/16000.
 */
export const STATE_PLANE_ZONES: readonly StatePlaneZone[] = Object.freeze([
  { fips: "3101", name: "New York East", state: "NY", epsg: 32115, epsgUsFeet: 2260, definition: tm(dms(38, 50), dms(-74, 30), 1 - 1 / 10_000, 150_000) },
  { fips: "3102", name: "New York Central", state: "NY", epsg: 32116, epsgUsFeet: 2261, definition: tm(40, dms(-76, 35), 1 - 1 / 16_000, 250_000) },
  { fips: "3103", name: "New York West", state: "NY", epsg: 32117, epsgUsFeet: 2262, definition: tm(40, dms(-78, 35), 1 - 1 / 16_000, 350_000) },
  { fips: "3104", name: "New York Long Island", state: "NY", epsg: 32118, epsgUsFeet: 2263, definition: lcc(dms(41, 2), dms(40, 40), dms(40, 10), -74, 300_000) },
  { fips: "4400", name: "Vermont", state: "VT", epsg: 32145, epsgUsFeet: null, definition: tm(dms(42, 30), dms(-72, 30), 1 - 1 / 28_000, 500_000) },
  { fips: "2800", name: "New Hampshire", state: "NH", epsg: 32110, epsgUsFeet: 3437, definition: tm(dms(42, 30), dms(-71, 40), 1 - 1 / 30_000, 300_000) },
  { fips: "1801", name: "Maine East", state: "ME", epsg: 26983, epsgUsFeet: 26847, definition: tm(dms(43, 40), dms(-68, 30), 1 - 1 / 10_000, 300_000) },
  { fips: "1802", name: "Maine West", state: "ME", epsg: 26984, epsgUsFeet: 26848, definition: tm(dms(42, 50), dms(-70, 10), 1 - 1 / 30_000, 900_000) },
] satisfies StatePlaneZone[]);

/** This function gives the zone of a FIPS zone code, for example `"3102"`, or `undefined` for a code that the list does not have. */
export function statePlaneZone(fips: string): StatePlaneZone | undefined {
  return STATE_PLANE_ZONES.find((zone) => zone.fips === fips);
}

const projections = new WeakMap<StatePlaneZone, Projection>();

/** This function gives the projection of a zone, with its plane in metres. The function keeps one projection for each zone object. */
export function statePlaneProjection(zone: StatePlaneZone): Projection {
  const known = projections.get(zone);
  if (known !== undefined) return known;
  const projection = conformalProjection(zone.definition);
  projections.set(zone, Object.freeze({ ...projection, name: `${zone.name} (SPCS 83, EPSG:${zone.epsg})` }));
  return projections.get(zone)!;
}

function unitMeters(unit: PlaneUnit): number {
  const meters = PLANE_UNIT_METERS[unit];
  if (meters === undefined) throw new GeoError("projection", `The unit ${String(unit)} is not a unit of PLANE_UNIT_METERS`);
  return meters;
}

/**
 * This function gives the point on the Earth (NAD83) of a point of a zone, in the unit of the zone plane.
 *
 * @param unit - The unit of `point`. The default is `meter`.
 * @throws GeoError - The code is `not-finite` or `projection`.
 */
export function fromStatePlane(zone: StatePlaneZone, point: PlanePoint, unit: PlaneUnit = "meter"): LatLon {
  const meters = unitMeters(unit);
  return statePlaneProjection(zone).fromPlane({ x: point.x * meters, y: point.y * meters });
}

/**
 * This function gives the point of a zone plane for a point on the Earth (NAD83), in a unit.
 *
 * @param unit - The unit of the result. The default is `meter`.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `projection`.
 */
export function toStatePlane(zone: StatePlaneZone, point: LatLon, unit: PlaneUnit = "meter"): PlanePoint {
  const meters = unitMeters(unit);
  const plane = statePlaneProjection(zone).toPlane(point);
  return { x: plane.x / meters, y: plane.y / meters };
}
