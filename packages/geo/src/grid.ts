/**
 * This module gives the region of a grid of values where each value is at a level or more, as a GeoJSON polygon. An
 * example is the area of each level of the shaking on the intensity grid of an earthquake.
 *
 * The rules:
 *
 * - The grid is regular in longitude and latitude, as an axis of CoverageJSON writes it: a start, a stop and a count.
 * - A value is at a point of the grid. Between the points, the value changes linearly along each edge of a cell.
 * - A point of the grid is in the region when its value is at the level or more. `NaN` or `null` is no value, and a
 *   point with no value is not in the region.
 * - The region stops at the edge of the grid. Where the region touches that edge, the boundary goes along it.
 * - The result follows RFC 7946. Each exterior ring goes counterclockwise, and each hole goes clockwise. No edge of
 *   the result crosses another edge.
 *
 * The method of marching squares gives the rings, with the tracer of `bufferKm`. The value at the center of a cell
 * decides a cell with two inside corners on a diagonal. That value is the mean of the values of the four corners.
 *
 * @packageDocumentation
 */

import { contourTracer, polygonsOf, type CellCorners } from "./contour.ts";
import { GeoError } from "./errors.ts";
import type { MultiPolygon, Polygon } from "./geojson.ts";
import type { Position } from "./point.ts";
import { simplifyKeeping } from "./simplify.ts";
import { checkRadius, EARTH_MEAN_RADIUS_KM } from "./sphere.ts";

/** A regular axis of a grid, as CoverageJSON writes it: the first value, the last value and the count of the values. */
export interface GridAxis {
  readonly start: number;
  readonly stop: number;
  /** The count of the values, an integer of 2 or more. */
  readonly num: number;
}

/** A regular grid of values in longitude and latitude. */
export interface ValueGrid {
  /** The longitudes of the columns, from -180 to 180. The start can be more than the stop. */
  readonly x: GridAxis;
  /** The latitudes of the rows, from -90 to 90. The start can be more than the stop. */
  readonly y: GridAxis;
  /**
   * The values, row by row: the value of the column `i` and the row `j` is `values[j * x.num + i]`. This is the order
   * of the axis names `["y", "x"]` of CoverageJSON. `NaN` or `null` is no value.
   */
  readonly values: ArrayLike<number | null>;
}

/** The options of `gridRegion`. */
export interface GridRegionOptions {
  /**
   * The tolerance of the simplification, in kilometres, 0 or more. The default is 0: the rings keep each position.
   * The simplification keeps each position on the edge of the grid.
   */
  readonly toleranceKm?: number;
  /** The radius of the sphere for the simplification, more than 0. The default is `EARTH_MEAN_RADIUS_KM`. */
  readonly radiusKm?: number;
}

/** The value of the field at a point with no value. It is far outside, so the boundary goes near the other point. */
const NO_VALUE = Number.MAX_VALUE;

/** This function examines an axis and gives its ends in increasing order. */
function checkAxis(axis: GridAxis, name: string, limit: number): { readonly low: number; readonly high: number; readonly reversed: boolean } {
  const { start, stop, num } = axis;
  if (!Number.isFinite(start) || !Number.isFinite(stop)) throw new GeoError("not-finite", `The axis ${name} has an end that is not a finite number`);
  if (!Number.isInteger(num) || num < 2) throw new GeoError("geojson-member", `The axis ${name} has the count ${num}. The count must be an integer of 2 or more`);
  if (start === stop) throw new GeoError("geojson-member", `The axis ${name} starts and stops at ${start}`);
  if (Math.abs(start) > limit || Math.abs(stop) > limit) {
    throw new GeoError(limit === 180 ? "longitude-range" : "latitude-range", `The axis ${name} goes out of the range from -${limit} to ${limit}`);
  }
  return { low: Math.min(start, stop), high: Math.max(start, stop), reversed: start > stop };
}

/**
 * This function gives the region of a grid where each value is at `level` or more. The module documentation gives the
 * rules. A region with no point gives an empty `MultiPolygon`.
 *
 * @param grid - The grid of values.
 * @param level - The level, a finite number.
 * @param options - The tolerance of the simplification.
 * @throws GeoError - `not-finite` for a level or an end of an axis, `geojson-member` for an incorrect axis or count of
 *   values, `longitude-range`, `latitude-range`, `tolerance` and `radius`.
 */
export function gridRegion(grid: ValueGrid, level: number, options: GridRegionOptions = {}): Polygon | MultiPolygon {
  if (!Number.isFinite(level)) throw new GeoError("not-finite", `The level ${level} is not a finite number`);
  const x = checkAxis(grid.x, "x", 180);
  const y = checkAxis(grid.y, "y", 90);
  const columns = grid.x.num - 1;
  const rows = grid.y.num - 1;
  if (grid.values.length !== grid.x.num * grid.y.num) {
    throw new GeoError("geojson-member", `The grid has ${grid.values.length} values. Its axes need ${grid.x.num * grid.y.num}`);
  }
  const toleranceKm = options.toleranceKm ?? 0;
  if (!Number.isFinite(toleranceKm)) throw new GeoError("not-finite", `The tolerance ${toleranceKm} is not a finite number`);
  if (toleranceKm < 0) throw new GeoError("tolerance", `The tolerance ${toleranceKm} is less than 0`);
  const radiusKm = options.radiusKm ?? EARTH_MEAN_RADIUS_KM;
  checkRadius(radiusKm);

  // The field is less than 0 in the region. A value at the level is in the region, so its field is just less than 0.
  const fieldAt = (i: number, j: number): number => {
    const column = x.reversed ? columns - i : i;
    const row = y.reversed ? rows - j : j;
    const value = grid.values[row * grid.x.num + column];
    if (value === null || value === undefined || Number.isNaN(value)) return NO_VALUE;
    const field = level - value;
    return field <= 0 ? Math.min(field, -Number.MIN_VALUE) : field;
  };

  const tracer = contourTracer({ west: x.low, east: x.high, south: y.low, north: y.high, columns, rows });
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < columns; i += 1) {
      const corners: CellCorners = [fieldAt(i, j), fieldAt(i + 1, j), fieldAt(i + 1, j + 1), fieldAt(i, j + 1)];
      const inside = corners.filter((value) => value < 0).length;
      if (inside === 0 || inside === 4) continue;
      tracer.march(i, j, corners, () => corners.reduce((sum, value) => sum + (value === NO_VALUE ? 0 : value), 0) / 4);
    }
  }
  const polygons = polygonsOf(tracer.rings(() => fieldAt(0, 0) < 0));
  if (polygons.length === 0) return { type: "MultiPolygon", coordinates: [] };
  let result = polygons;
  if (toleranceKm > 0) {
    const onGridEdge = (position: Position): boolean => position[0] === x.low || position[0] === x.high || position[1] === y.low || position[1] === y.high;
    const [simplified] = simplifyKeeping([{ type: "MultiPolygon", coordinates: polygons }], toleranceKm, radiusKm, onGridEdge);
    result = (simplified as MultiPolygon).coordinates as Position[][][];
  }
  return result.length === 1 ? { type: "Polygon", coordinates: result[0] as Position[][] } : { type: "MultiPolygon", coordinates: result };
}
