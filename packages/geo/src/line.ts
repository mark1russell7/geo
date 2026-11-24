/**
 * This module has functions on lines: lists of GeoJSON positions, for example the parts of a street or of a path.
 *
 * - `joinLines` joins lines with a common end into longer lines.
 * - `lineReference` puts a line on a plane in metres one time. Then it gives the nearest point of the line to a point,
 *   and the point at a distance along the line.
 * - `nearestOnLine` and `pointAlongLine` do one query each, with a new `lineReference`.
 *
 * @packageDocumentation
 */

// A stated shortcut, a decision of the maintainer on 2026-11-24. The planar steps of this module (`joinLines`, and the
// nearest point and the point along a line in `lineReference`) are a copy of `chainPolylines`, `locateOnPolyline` and
// `pointAlongPolyline` of `@mark1russell7/layout-contract`, the home of points on a plane.
// - The reason: layout-contract adds 5 dependencies to this base package (layout-contract, typeset, strategy-space,
//   rigor-generators and rigor-statistics).
// - The end: when those three functions are in a package or an entry that installs with no strategy and no text
//   dependencies (the item layout-contract-lean-geometry). Then this module uses them and deletes its own steps.

import { orient2dSign } from "@mark1russell7/predicates";
import { GeoError } from "./errors.ts";
import { checkPosition } from "./geojson.ts";
import { checkPoint, normalizeLon, type LatLon, type Position } from "./point.ts";
import { azimuthalEquidistant, type PlanePoint, type Projection } from "./projection.ts";

/** The options of `lineReference`, `nearestOnLine` and `pointAlongLine`. */
export interface LineOptions {
  /**
   * The plane of the measures. The default is `azimuthalEquidistant` with the center at the first position of the line.
   * Each length is in the metres of this plane.
   */
  readonly projection?: Projection;
}

/**
 * The side of a point against a line, for the direction from the first position to the last position. The value 1 is
 * the left side, -1 is the right side, and 0 is on the line.
 */
export type LineSide = -1 | 0 | 1;

/** The nearest point of a line to a point. Each length is in the metres of the plane of the line. */
export interface NearestOnLine {
  /** The nearest point of the line. */
  readonly point: LatLon;
  /** The distance from the point to the line. */
  readonly meters: number;
  /** The distance along the line from its first position to the nearest point. */
  readonly alongMeters: number;
  /**
   * The side of the point against the segment of the nearest point. The sign is exact on the plane, from
   * `orient2dSign` of `@mark1russell7/predicates`.
   */
  readonly side: LineSide;
}

/** A line on a plane in metres. It puts the positions on the plane one time, for many queries. */
export interface LineReference {
  /** The plane of the measures. */
  readonly projection: Projection;
  /** The length of the line on the plane. */
  readonly lengthMeters: number;
  /**
   * This function gives the nearest point of the line to a point. Two segments at the same distance give the first.
   *
   * @throws GeoError - The code is `not-finite` or `latitude-range`.
   */
  readonly nearest: (point: LatLon) => NearestOnLine;
  /**
   * This function gives the point at a distance along the line, moved by an offset at right angles to the line.
   *
   * @param alongMeters - The distance from the first position. A value out of the range from 0 to `lengthMeters` gives an end.
   * @param offsetMeters - The offset to the left. A negative value goes to the right. The default is 0.
   * @throws GeoError - The code is `not-finite`.
   */
  readonly pointAt: (alongMeters: number, offsetMeters?: number) => LatLon;
}

/** This function gives the key of an end. Two ends are equal when their keys are equal. */
function endKey(position: Position): string {
  const lat = position[1];
  // Each longitude at a pole is the same point.
  if (lat === 90 || lat === -90) return `${lat}`;
  return `${lat + 0},${normalizeLon(position[0])}`;
}

/** This function examines a line: an array of two or more positions. */
function checkLinePositions(line: readonly Position[], path: string): void {
  if (!Array.isArray(line)) throw new GeoError("geojson-member", "A line must be an array of positions", path);
  line.forEach((position, index) => checkPosition(position, `${path}[${index}]`));
  if (line.length < 2) throw new GeoError("too-few-positions", "A line has two or more positions", path);
}

/**
 * This function joins lines with a common end into longer lines, for example the ways of one street. Each input line
 * goes into one result line, forward or reversed.
 *
 * - Two ends are equal when their latitudes are equal and their normalized longitudes are equal. The altitude has no
 *   effect. At a pole, each longitude is the same end.
 * - Each result line starts with the first input line that is not in a result line yet. It keeps the direction of that line.
 * - The function adds lines at the last end while a line fits there, then at the first end.
 * - At an end of three or more lines, the function takes the first line in the input order. Each other line starts a
 *   new result line, or goes into one.
 * - The common position of two joined lines is in the result one time. The result has the positions of the input, not copies.
 *
 * @param lines - The lines. Each line has two or more positions.
 * @returns The joined lines, in the order of their first input line.
 * @throws GeoError - The code is `geojson-member`, `position`, `not-finite`, `latitude-range` or `too-few-positions`.
 */
export function joinLines(lines: readonly (readonly Position[])[]): Position[][] {
  if (!Array.isArray(lines)) throw new GeoError("geojson-member", "The lines must be an array");
  lines.forEach((line, index) => checkLinePositions(line, `[${index}]`));
  // The lines at each end, in the input order.
  const ends = new Map<string, number[]>();
  const addEnd = (key: string, index: number): void => {
    const list = ends.get(key);
    if (list === undefined) ends.set(key, [index]);
    else if (list.at(-1) !== index) list.push(index);
  };
  lines.forEach((line, index) => {
    addEnd(endKey(line[0] as Position), index);
    addEnd(endKey(line.at(-1) as Position), index);
  });
  const used = new Array<boolean>(lines.length).fill(false);
  const nextAt = (key: string): number | undefined => ends.get(key)?.find((index) => !used[index]);
  /** This function adds the positions of a line from the end at `key`, without that end, to `out`. */
  const walkFrom = (line: readonly Position[], key: string, out: Position[]): void => {
    if (endKey(line[0] as Position) === key) for (let index = 1; index < line.length; index += 1) out.push(line[index] as Position);
    else for (let index = line.length - 2; index >= 0; index -= 1) out.push(line[index] as Position);
  };
  /** This function adds lines at one end while a line fits there. `end` gives the current position of that end. */
  const grow = (end: () => Position, out: Position[]): void => {
    for (;;) {
      const key = endKey(end());
      const next = nextAt(key);
      if (next === undefined) return;
      used[next] = true;
      walkFrom(lines[next] as readonly Position[], key, out);
    }
  };
  const result: Position[][] = [];
  lines.forEach((first, start) => {
    if (used[start]) return;
    used[start] = true;
    // The positions from the first line to the last end, and the positions before the first line in reverse order.
    const tail: Position[] = [...first];
    const head: Position[] = [];
    grow(() => tail.at(-1) as Position, tail);
    grow(() => (head.at(-1) ?? tail[0]) as Position, head);
    result.push([...head.reverse(), ...tail]);
  });
  return result;
}

/** This function refuses a number that is not finite. */
function checkFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new GeoError("not-finite", `The ${name} ${value} is not a finite number`);
}

/**
 * This function puts a line on a plane in metres one time. Then the line gives the nearest point to a point, and the
 * point at a distance along it.
 *
 * - The default plane is `azimuthalEquidistant` at the first position of the line. On it, the scale is less than
 *   1.000002 within 20 km of that position. So for a street, a length on the plane is the length on the ellipsoid.
 * - A different `projection` gives each length in its metres. For example, a length on `WEB_MERCATOR` at 60 degrees is
 *   approximately two times the true length.
 * - A segment of length 0 has no direction. The queries skip it. A line of length 0 gives its first position, with side 0.
 *
 * @param line - The positions of the line, two or more.
 * @param options - The plane of the measures.
 * @throws GeoError - The code is `geojson-member`, `position`, `not-finite`, `latitude-range` or `too-few-positions`.
 */
export function lineReference(line: readonly Position[], options: LineOptions = {}): LineReference {
  checkLinePositions(line, "");
  const start = line[0] as Position;
  const projection = options.projection ?? azimuthalEquidistant({ lat: start[1], lon: start[0] });
  const plane: readonly PlanePoint[] = line.map((position) => projection.toPlane({ lat: position[1], lon: position[0] }));
  // The distance along the line at each position.
  const runs: number[] = [0];
  for (let index = 1; index < plane.length; index += 1) {
    const a = plane[index - 1] as PlanePoint;
    const b = plane[index] as PlanePoint;
    runs.push((runs[index - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const lengthMeters = runs.at(-1) as number;

  const nearest = (point: LatLon): NearestOnLine => {
    checkPoint(point);
    const q = projection.toPlane(point);
    const origin = plane[0] as PlanePoint;
    let best = { meters: Math.hypot(q.x - origin.x, q.y - origin.y), along: 0, side: 0, x: origin.x, y: origin.y };
    let found = false;
    for (let index = 1; index < plane.length; index += 1) {
      const a = plane[index - 1] as PlanePoint;
      const b = plane[index] as PlanePoint;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const squared = dx * dx + dy * dy;
      if (squared === 0) continue;
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / squared));
      // At t = 1, the point is the end of the segment, with no rounding.
      const x = t === 1 ? b.x : a.x + t * dx;
      const y = t === 1 ? b.y : a.y + t * dy;
      const meters = Math.hypot(q.x - x, q.y - y);
      if (found && meters >= best.meters) continue;
      found = true;
      const along = (runs[index - 1] as number) + t * ((runs[index] as number) - (runs[index - 1] as number));
      best = { meters, along, side: meters === 0 ? 0 : orient2dSign(a.x, a.y, b.x, b.y, q.x, q.y), x, y };
    }
    return { point: projection.fromPlane({ x: best.x, y: best.y }), meters: best.meters, alongMeters: best.along, side: best.side as LineSide };
  };

  const pointAt = (alongMeters: number, offsetMeters: number = 0): LatLon => {
    checkFinite(alongMeters, "distance along the line");
    checkFinite(offsetMeters, "offset");
    const along = Math.max(0, Math.min(lengthMeters, alongMeters));
    // The first segment of length more than 0 that ends at the distance or after it.
    for (let index = 1; index < plane.length; index += 1) {
      const a = plane[index - 1] as PlanePoint;
      const b = plane[index] as PlanePoint;
      const length = (runs[index] as number) - (runs[index - 1] as number);
      if (length === 0 || (runs[index] as number) < along) continue;
      const t = Math.max(0, Math.min(1, (along - (runs[index - 1] as number)) / length));
      // The unit normal to the left of the segment.
      const nx = -(b.y - a.y) / length;
      const ny = (b.x - a.x) / length;
      const x = t === 1 ? b.x : a.x + t * (b.x - a.x);
      const y = t === 1 ? b.y : a.y + t * (b.y - a.y);
      return projection.fromPlane({ x: x + offsetMeters * nx, y: y + offsetMeters * ny });
    }
    return projection.fromPlane(plane[0] as PlanePoint);
  };

  return Object.freeze({ projection, lengthMeters, nearest, pointAt });
}

/**
 * This function gives the nearest point of a line to a point: the distance, the distance along the line, and the side.
 * For many points on one line, use `lineReference`. Its rules apply.
 *
 * @param line - The positions of the line, two or more.
 * @param point - The point.
 * @param options - The plane of the measures.
 * @throws GeoError - The code is `geojson-member`, `position`, `not-finite`, `latitude-range` or `too-few-positions`.
 */
export function nearestOnLine(line: readonly Position[], point: LatLon, options?: LineOptions): NearestOnLine {
  return lineReference(line, options).nearest(point);
}

/**
 * This function gives the point at a distance along a line, moved by an offset to the left or to the right. For many
 * points on one line, use `lineReference`. Its rules apply.
 *
 * @param line - The positions of the line, two or more.
 * @param alongMeters - The distance from the first position. A value out of the range from 0 to the length gives an end.
 * @param offsetMeters - The offset to the left. A negative value goes to the right. The default is 0.
 * @param options - The plane of the measures.
 * @throws GeoError - The code is `geojson-member`, `position`, `not-finite`, `latitude-range` or `too-few-positions`.
 */
export function pointAlongLine(line: readonly Position[], alongMeters: number, offsetMeters: number = 0, options?: LineOptions): LatLon {
  return lineReference(line, options).pointAt(alongMeters, offsetMeters);
}
