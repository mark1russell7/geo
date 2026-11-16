/**
 * This module adds positions to the edges of a geometry. An edge of GeoJSON is a straight line in longitude and
 * latitude (RFC 7946, section 3.1). A globe or a map with a different projection draws a different line between two
 * positions. With short edges, the difference is small.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import { checkPosition, MAX_GEOJSON_DEPTH, type Geometry } from "./geojson.ts";
import type { Position } from "./point.ts";

/** The largest number of positions that `densify` adds in one call. */
export const MAX_DENSIFY_POSITIONS = 1_000_000;

/** The positions that one call added. */
interface Count {
  added: number;
}

type Line = readonly Position[];

/**
 * This function gives the value at a part of the way from `a` to `b`. The result is the same when `a` and `b` change
 * places and the part becomes `parts - part`. The result is not out of the range from `a` to `b`.
 */
function between(a: number, b: number, part: number, parts: number): number {
  // The smallest of two equal values is one value, also for 0 and -0.
  if (a === b) return Math.min(a, b);
  const value = (a * (parts - part) + b * part) / parts;
  return Math.min(Math.max(value, Math.min(a, b)), Math.max(a, b));
}

function densifyLine(line: Line, maxStep: number, path: string, count: Count): Line {
  const result: Position[] = [];
  line.forEach((position, index) => {
    checkPosition(position, `${path}[${index}]`);
    const previous = line[index - 1];
    if (previous !== undefined) {
      const span = Math.max(Math.abs(position[0] - previous[0]), Math.abs(position[1] - previous[1]));
      const parts = Math.ceil(span / maxStep);
      count.added += Math.max(parts - 1, 0);
      if (count.added > MAX_DENSIFY_POSITIONS) {
        throw new GeoError("step", `The step ${maxStep} adds more than ${MAX_DENSIFY_POSITIONS} positions`, path);
      }
      // A new position has an altitude only when the two ends of its edge have one.
      const length = Math.min(previous.length, position.length);
      for (let part = 1; part < parts; part += 1) {
        const added: [number, number, ...number[]] = [
          between(previous[0], position[0], part, parts),
          between(previous[1], position[1], part, parts),
        ];
        for (let item = 2; item < length; item += 1) {
          added.push(between(previous[item] as number, position[item] as number, part, parts));
        }
        result.push(added);
      }
    }
    result.push(position);
  });
  return result;
}

function densifyGeometry(geometry: Geometry, maxStep: number, path: string, depth: number, count: Count): Geometry {
  const coordinates = path === "" ? "coordinates" : `${path}.coordinates`;
  const lines = (list: readonly Line[], prefix: string): readonly Line[] =>
    list.map((line, index) => densifyLine(line, maxStep, `${prefix}[${index}]`, count));
  switch (geometry.type) {
    case "Point":
      checkPosition(geometry.coordinates, coordinates);
      return geometry;
    case "MultiPoint":
      geometry.coordinates.forEach((position, index) => checkPosition(position, `${coordinates}[${index}]`));
      return geometry;
    case "LineString":
      return { ...geometry, coordinates: densifyLine(geometry.coordinates, maxStep, coordinates, count) };
    case "MultiLineString":
      return { ...geometry, coordinates: lines(geometry.coordinates, coordinates) };
    case "Polygon":
      return { ...geometry, coordinates: lines(geometry.coordinates, coordinates) };
    case "MultiPolygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon, index) => lines(polygon, `${coordinates}[${index}]`)),
      };
    case "GeometryCollection":
      if (depth >= MAX_GEOJSON_DEPTH) throw new GeoError("too-deep", "The collections are nested too deep", path);
      return {
        ...geometry,
        geometries: geometry.geometries.map((child, index) =>
          densifyGeometry(child, maxStep, `${path === "" ? "" : `${path}.`}geometries[${index}]`, depth + 1, count),
        ),
      };
    default:
      throw new GeoError("geojson-type", "The value is not a GeoJSON geometry", path);
  }
}

/**
 * This function gives a copy of a geometry with more positions on its edges. It divides each edge into equal parts,
 * so that no part is longer than `maxStep` degrees of longitude or of latitude. Use it before a drawing on a globe.
 *
 * - Each new position is on the straight line in longitude and latitude between the two ends of its edge. The
 *   positions of the geometry stay, in the same sequence. So the geometry has the same points and the same box.
 * - An edge gives the same new positions in the two directions. So two polygons with a common border stay together.
 * - A `Point` and a `MultiPoint` have no edge, and the function gives them as they are.
 * - A new position has an altitude only when the two ends of its edge have one.
 * - The copy keeps the other members of the object.
 *
 * @param maxStep - The largest step in degrees, more than 0.
 * @throws GeoError - The code is `step`, `not-finite`, `position`, `latitude-range`, `geojson-type` or `too-deep`.
 */
export function densify<G extends Geometry>(geometry: G, maxStep: number): G {
  if (!Number.isFinite(maxStep)) throw new GeoError("not-finite", `The step ${maxStep} is not a finite number`);
  if (maxStep <= 0) throw new GeoError("step", `The step ${maxStep} must be more than 0`);
  return densifyGeometry(geometry, maxStep, "", 0, { added: 0 }) as G;
}
