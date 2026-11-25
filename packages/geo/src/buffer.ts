/**
 * This module gives the buffer of a GeoJSON geometry: the area within a distance of the geometry, as a GeoJSON polygon
 * for a map. The buffer of a point is a circle, and the buffer of a polygon includes the polygon.
 *
 * The rules:
 *
 * - The distance is the great-circle distance of `distanceToGeometryKm`. An edge is a straight line in longitude and
 *   latitude, as in RFC 7946 and in the other functions of this package.
 * - The guarantee: each point at a distance of `distance - tolerance` or less is in the result. Each point at a distance
 *   of `distance + tolerance` or more is not in the result. A point between the two limits can be on each side.
 * - The result follows RFC 7946. Each longitude is from -180 to 180. Each exterior ring goes counterclockwise, and each
 *   hole goes clockwise. No edge of the result crosses another edge.
 * - A buffer across the antimeridian is cut there, at 180 and at -180, as a circle of `circleKm` is.
 * - A buffer around a pole has an edge along the pole.
 * - A buffer of a geometry with no position is an empty `MultiPolygon`. A distance of half the circumference of the
 *   sphere or more gives the whole Earth.
 *
 * The method:
 *
 * - The buffer is the area where the field `f(p) = (the distance from p to the geometry) - distance` is less than 0.
 *   A change of the point by a distance changes `f` by that distance or less.
 * - A grid of cells in longitude and latitude covers the buffer. The diameter of each cell is 5/8 of the tolerance or
 *   less. A tree of blocks of cells finds the cells near the boundary of the buffer. A block is wholly in or out when
 *   its `|f|` at its center is more than its radius plus the slack. The tree does not divide such a block.
 * - Each block keeps the edges that can be the nearest edge for a point in it. Thus a small block examines few edges.
 * - The search of the nearest point of an edge stops early. Thus the value of `f` can be more than the true value by
 *   the slack, 1/16 of the tolerance, or less.
 * - The method of marching squares on the cells near the boundary gives the rings. The value at the center of a cell
 *   decides a cell with two inside corners on a diagonal.
 * - The method of `simplifyRegions` removes positions within 1/4 of the tolerance from the rings. It keeps each
 *   position on the edge of the grid, for example on the antimeridian or on a pole.
 * - Each point of a cell with a segment of the boundary has `|f|` of the diameter plus the slack or less. The
 *   simplification moves the boundary by 1/4 of the tolerance or less. The sum is 15/16 of the tolerance, so the result
 *   keeps the guarantee.
 *
 * The cost is in proportion to the count of the cells near the boundary: approximately 9 times the length of the
 * boundary over the tolerance. Each of these cells examines the edges near it. A buffer of 10 km with the tolerance 0.1 km
 * around a coast of 5,000 km uses approximately 450,000 cells.
 *
 * @packageDocumentation
 */

import { angleToEdge, angleToEdges, scanEdges, shapesOf, viewerAt } from "./distance.ts";
import { GeoError } from "./errors.ts";
import type { Geometry, MultiPolygon, Polygon } from "./geojson.ts";
import { pointLocator } from "./locator.ts";
import type { Position } from "./point.ts";
import { simplifyKeeping } from "./simplify.ts";
import { contourTracer, polygonsOf, type CellCorners } from "./contour.ts";
import { checkRadius, EARTH_MEAN_RADIUS_KM, EARTH_MEAN_RADIUS_METERS } from "./sphere.ts";

const RADIANS = Math.PI / 180;

/** The default limit of the count of the cells near the boundary of a buffer. */
export const DEFAULT_MAX_BUFFER_CELLS = 1_000_000;

/** The options of `bufferKm` and `bufferMeters`. */
export interface BufferOptions {
  /**
   * The tolerance of the boundary, in the unit of the distance. It is more than 0 and less than the distance. The
   * default is the distance over 100. A small tolerance gives a boundary nearer to the true boundary, with more cells.
   */
  readonly tolerance?: number;
  /**
   * The limit of the count of the cells near the boundary, a value of 1 or more. The default is
   * `DEFAULT_MAX_BUFFER_CELLS`. A buffer that needs more cells gives the error `too-many-cells`.
   */
  readonly maxCells?: number;
}

/** The whole Earth as a ring, counterclockwise. */
const WORLD: readonly Position[] = [
  [-180, -90],
  [180, -90],
  [180, 90],
  [-180, 90],
  [-180, -90],
];

/**
 * The largest diameter of a cell over the tolerance. A cell with a segment of the boundary has a point where `f` is 0.
 * Thus `|f|` at each point of that cell is not more than the diameter. `cellSide` gives the side of such a cell.
 */
const DIAMETER_PART = 5 / 8;

/**
 * The slack of the field over the tolerance. The field can be more than the true field by the slack or less, so the
 * search of each edge stops early. A cell with a segment then has `|f|` of its diameter plus the slack or less.
 */
const SLACK_PART = 1 / 16;

/** The tolerance of the simplification over the tolerance of the buffer. */
const SIMPLIFY_PART = 1 / 4;

/**
 * This function gives the side of a cell, in radians, for a largest diameter in radians. The latitude side of a cell
 * is not more than the side. The longitude side, times the largest cosine of the latitudes of the grid, is not more
 * than the side. For two points of the cell, the haversine formula then gives `sin²(d / 2) <= side² / 2`. Thus the
 * angle `d` is not more than `2 asin(side / √2)`, which is the diameter. A small factor keeps the bound after the
 * rounding of the grid.
 */
function cellSide(diameter: number): number {
  return Math.SQRT2 * Math.sin(diameter / 2) * (1 - 2 ** -20);
}

/** The largest count of the corners of a grid. The keys of the corners and of the crossings stay exact integers. */
const MAX_GRID_CORNERS = 2 ** 50;

/** The elements of a geometry: its edges and its points. A point is an edge from the point to the same point. */
interface Elements {
  readonly from: Position[];
  readonly to: Position[];
  /** 1 for an edge of a polygon. */
  readonly polygonEdge: number[];
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  /** The test of a point against the polygons: `true` when the point is in a polygon or on its boundary. */
  readonly inPolygon: ((lon: number, lat: number) => boolean) | undefined;
}

/** The grid: the box of the buffer, and the count of the cells in longitude and in latitude. */
interface Grid {
  readonly west: number;
  readonly east: number;
  readonly south: number;
  readonly north: number;
  readonly columns: number;
  readonly rows: number;
  /** `true` when the grid goes from -180 to 180. Then the corners at 180 have the values of the corners at -180. */
  readonly wraps: boolean;
}

/** A block of cells of the tree: the columns from `i0` to `i1` and the rows from `j0` to `j1`, with the ends excluded. */
interface Block {
  readonly i0: number;
  readonly i1: number;
  readonly j0: number;
  readonly j1: number;
  /** The elements that can be the nearest element for a point of the block. */
  readonly list: Int32Array;
  /** 1 when the block is wholly in a polygon, 0 when it is wholly out of each polygon, -1 when it is not known. */
  readonly inside: number;
}

function elementsOf(geometry: Geometry): Elements {
  const shapes = shapesOf(geometry, "");
  const from: Position[] = [];
  const to: Position[] = [];
  const polygonEdge: number[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const extend = (position: Position): void => {
    minX = Math.min(minX, position[0]);
    maxX = Math.max(maxX, position[0]);
    minY = Math.min(minY, position[1]);
    maxY = Math.max(maxY, position[1]);
  };
  const add = (a: Position, b: Position, edgeOfPolygon: number): void => {
    from.push(a);
    to.push(b);
    polygonEdge.push(edgeOfPolygon);
    extend(a);
    extend(b);
  };
  for (const position of shapes.points) add(position, position, 0);
  for (const part of shapes.lines) {
    for (const line of part.rings) {
      if (line.length === 1) add(line[0] as Position, line[0] as Position, 0);
      for (let index = 0; index + 1 < line.length; index += 1) add(line[index] as Position, line[index + 1] as Position, 0);
    }
  }
  for (const part of shapes.polygons) {
    for (const ring of part.rings) {
      for (let index = 0; index + 1 < ring.length; index += 1) add(ring[index] as Position, ring[index + 1] as Position, 1);
    }
  }
  let inPolygon: Elements["inPolygon"];
  if (shapes.polygons.length > 0) {
    const locate = pointLocator({ type: "MultiPolygon", coordinates: shapes.polygons.map((part) => part.rings) });
    inPolygon = (lon, lat) => locate({ lat, lon }) !== "outside";
  }
  return { from, to, polygonEdge, minX, maxX, minY, maxY, inPolygon };
}

/** This function gives the grid of a buffer. The angles are in radians: the distance plus the tolerance, and the cell radius. */
function gridOf(elements: Elements, reach: number, cell: number, maxCells: number): Grid {
  const pad = reach / RADIANS;
  let south = elements.minY - pad;
  let north = elements.maxY + pad;
  let west = -180;
  let east = 180;
  let wraps = true;
  if (south <= -90 || north >= 90) {
    south = Math.max(-90, south);
    north = Math.min(90, north);
  } else {
    // A point at the angle `reach` or less from a point at the latitude `phi` is within this longitude difference.
    const phi = Math.max(Math.abs(elements.minY), Math.abs(elements.maxY)) * RADIANS;
    const lonPad = (Math.asin(Math.min(1, Math.sin(reach) / Math.cos(phi))) / RADIANS) * (1 + 2 ** -20) + 2 ** -30;
    if (elements.minX - lonPad > -180 && elements.maxX + lonPad < 180) {
      west = elements.minX - lonPad;
      east = elements.maxX + lonPad;
      wraps = false;
    }
  }
  const cosMax = south <= 0 && north >= 0 ? 1 : Math.cos(Math.min(Math.abs(south), Math.abs(north)) * RADIANS);
  const rows = Math.max(1, Math.ceil(((north - south) * RADIANS) / cell));
  const columns = Math.max(1, Math.ceil((cosMax * (east - west) * RADIANS) / cell));
  if ((columns + 1) * (rows + 1) > MAX_GRID_CORNERS) {
    throw new GeoError("too-many-cells", `The buffer needs a grid of ${columns} by ${rows} cells, and the limit is ${maxCells}`);
  }
  return { west, east, south, north, columns, rows, wraps };
}

/** This function gives the rings of the area where the field is less than 0, in the lon and lat plane. */
function contourRings(elements: Elements, grid: Grid, angle: number, slack: number, maxCells: number): Position[][] {
  const { west, east, south, north, columns, rows } = grid;
  const lonAt = (i: number): number => (i === columns ? east : west + (east - west) * (i / columns));
  const latAt = (j: number): number => (j === rows ? north : south + (north - south) * (j / rows));
  const { from, to, polygonEdge, inPolygon } = elements;

  /** The field at a point, from the elements of a list. */
  const fieldAt = (lon: number, lat: number, list: Int32Array, inside: number): number => {
    if (inside === 1 || (inside === -1 && inPolygon !== undefined && inPolygon(lon, lat))) return -angle;
    return angleToEdges(viewerAt([lon, lat]), from, to, list, slack) - angle;
  };

  // The value of each corner of the grid. All the corners at a pole are one point, so they get one value.
  const corners = new Map<number, number>();
  const poles = new Map<number, number>();
  const cornerAt = (i: number, j: number, list: Int32Array, inside: number): number => {
    const lat = latAt(j);
    if (lat === 90 || lat === -90) {
      let value = poles.get(lat);
      if (value === undefined) {
        value = fieldAt(0, lat, list, inside);
        poles.set(lat, value);
      }
      return value;
    }
    const column = grid.wraps && i === columns ? 0 : i;
    const key = j * (columns + 1) + column;
    let value = corners.get(key);
    if (value === undefined) {
      value = fieldAt(lonAt(column), lat, list, inside);
      corners.set(key, value);
    }
    return value;
  };

  const tracer = contourTracer(grid);
  /**
   * This function adds the segments of the cell at the column `i` and the row `j`, with marching squares. A cell with
   * four crossings gets the value at its center from `centerOf`.
   */
  const march = (i: number, j: number, list: Int32Array, inside: number, centerOf: () => number): void => {
    const corners: CellCorners = [
      cornerAt(i, j, list, inside),
      cornerAt(i + 1, j, list, inside),
      cornerAt(i + 1, j + 1, list, inside),
      cornerAt(i, j + 1, list, inside),
    ];
    tracer.march(i, j, corners, centerOf);
  };

  let cells = 0;
  const all = new Int32Array(from.length);
  for (let k = 0; k < all.length; k += 1) all[k] = k;
  const stack: Block[] = [{ i0: 0, i1: columns, j0: 0, j1: rows, list: all, inside: inPolygon === undefined ? 0 : -1 }];
  while (stack.length > 0) {
    // A block in the stack is not wholly in a polygon: the division does not push such a block.
    const block = stack.pop() as Block;
    const width = block.i1 - block.i0;
    const height = block.j1 - block.j0;
    if (width === 1 && height === 1) {
      // A cell needs no test at its center: a cell whose corners are all on one side gives no segment.
      cells += 1;
      if (cells > maxCells) {
        throw new GeoError("too-many-cells", `The buffer needs more than ${maxCells} cells near its boundary. Use a larger tolerance`);
      }
      const { i0, j0, list, inside } = block;
      march(i0, j0, list, inside, () => fieldAt((lonAt(i0) + lonAt(i0 + 1)) / 2, (latAt(j0) + latAt(j0 + 1)) / 2, list, inside));
      continue;
    }
    const lon0 = lonAt(block.i0);
    const lon1 = lonAt(block.i1);
    const lat0 = latAt(block.j0);
    const lat1 = latAt(block.j1);
    // The center of a block with an even width and height is a corner of the grid. Its value is then the value of that
    // corner, so the cells of the block do not examine it again.
    const evenCenter = width % 2 === 0 && height % 2 === 0;
    const lon = evenCenter ? lonAt((block.i0 + block.i1) / 2) : (lon0 + lon1) / 2;
    const lat = evenCenter ? latAt((block.j0 + block.j1) / 2) : (lat0 + lat1) / 2;
    const cosMax = lat0 <= 0 && lat1 >= 0 ? 1 : Math.cos(Math.min(Math.abs(lat0), Math.abs(lat1)) * RADIANS);
    // A point of the block is within this angle of its center: along the meridian, then along the parallel.
    const radius = ((lat1 - lat0) / 2 + (cosMax * (lon1 - lon0)) / 2) * RADIANS;
    const limit = radius * (1 + 2 ** -20) + 2 ** -40;
    // The value of a point can be more than its true value by the slack. Thus a block is wholly in or out only when the
    // value at its center is farther than its radius plus the slack from 0. Then each corner of the block keeps its side.
    const margin = limit + slack;
    const centerIn = block.inside === -1 && inPolygon !== undefined && inPolygon(lon, lat);
    if (centerIn && angle > margin) continue;
    const viewer = viewerAt([lon, lat]);
    const bounds = new Float64Array(block.list.length);
    const best = scanEdges(viewer, from, to, block.list, bounds, slack);
    const center = centerIn ? -angle : best - angle;
    if (Math.abs(center) > margin) continue;
    if (evenCenter) corners.set(((block.j0 + block.j1) / 2) * (columns + 1) + (block.i0 + block.i1) / 2, center);
    // An element that is more than `best + 2 radius` from the center is not the nearest element for a point of the block.
    // The bound of an element is not more than its angle, so the list keeps each element that can be the nearest.
    const keep = best + 2 * limit;
    let kept = 0;
    for (let index = 0; index < bounds.length; index += 1) if ((bounds[index] as number) <= keep) kept += 1;
    const list = new Int32Array(kept);
    kept = 0;
    for (let index = 0; index < bounds.length; index += 1) if ((bounds[index] as number) <= keep) list[kept++] = block.list[index] as number;
    // When no edge of a polygon meets the block, the block is wholly in a polygon or wholly out of each polygon.
    let inside = block.inside;
    if (inside === -1) {
      let meets = false;
      for (let index = 0; index < bounds.length && !meets; index += 1) {
        const k = block.list[index] as number;
        if (polygonEdge[k] !== 1 || (bounds[index] as number) > limit) continue;
        meets = angleToEdge(viewer, from[k] as Position, to[k] as Position) <= limit;
      }
      if (!meets) inside = centerIn ? 1 : 0;
    }
    if (inside === 1) continue;
    // A block divides along each side that is not much shorter than the other side, in cells.
    const splitX = width > 1 && 2 * width > height;
    const splitY = height > 1 && 2 * height > width;
    const iMid = Math.floor((block.i0 + block.i1) / 2);
    const jMid = Math.floor((block.j0 + block.j1) / 2);
    const columnsOf = splitX ? [[block.i0, iMid], [iMid, block.i1]] : [[block.i0, block.i1]];
    const rowsOf = splitY ? [[block.j0, jMid], [jMid, block.j1]] : [[block.j0, block.j1]];
    for (const [i0, i1] of columnsOf) {
      for (const [j0, j1] of rowsOf) stack.push({ i0: i0 as number, i1: i1 as number, j0: j0 as number, j1: j1 as number, list, inside });
    }
  }

  // The edge of the grid is wholly in the buffer when no boundary meets it and its south-west corner is in the buffer.
  return tracer.rings(() => grid.wraps && fieldAt(west, south, all, inPolygon === undefined ? 0 : -1) < 0);
}

/** This function examines the options of a buffer and gives the tolerance and the limit of the cells. */
function checkOptions(distance: number, options: BufferOptions): { readonly tolerance: number; readonly maxCells: number } {
  const tolerance = options.tolerance ?? distance / 100;
  if (!Number.isFinite(tolerance)) throw new GeoError("not-finite", `The tolerance ${tolerance} is not a finite number`);
  if (!(tolerance > 0 && tolerance < distance)) {
    throw new GeoError("tolerance", `The tolerance ${tolerance} must be more than 0 and less than the distance ${distance}`);
  }
  const maxCells = options.maxCells ?? DEFAULT_MAX_BUFFER_CELLS;
  if (Number.isNaN(maxCells) || maxCells < 1) {
    throw new GeoError("max-cells", `The limit ${maxCells} of cells must be a number of 1 or more`);
  }
  return { tolerance, maxCells };
}

/** This function examines the input of a buffer and gives the buffer. The distances and the sphere use one unit. */
function buffer(geometry: Geometry, distance: number, sphereRadius: number, options: BufferOptions): Polygon | MultiPolygon {
  checkRadius(distance);
  checkRadius(sphereRadius);
  const { tolerance, maxCells } = checkOptions(distance, options);
  const elements = elementsOf(geometry);
  if (elements.from.length === 0) return { type: "MultiPolygon", coordinates: [] };
  // The test uses the distance and not the angle, so a distance of exactly half the circumference is the whole Earth.
  if (distance >= Math.PI * sphereRadius) return { type: "Polygon", coordinates: [[...WORLD]] };
  const angle = distance / sphereRadius;
  const cell = cellSide((tolerance / sphereRadius) * DIAMETER_PART);
  const grid = gridOf(elements, angle + tolerance / sphereRadius, cell, maxCells);
  const polygons = polygonsOf(contourRings(elements, grid, angle, (tolerance / sphereRadius) * SLACK_PART, maxCells));
  const onGridEdge = (position: Position): boolean =>
    position[0] === grid.west || position[0] === grid.east || position[1] === grid.south || position[1] === grid.north;
  const region: MultiPolygon = { type: "MultiPolygon", coordinates: polygons };
  const [simplified] = simplifyKeeping([region], tolerance * SIMPLIFY_PART, sphereRadius, onGridEdge);
  const result = (simplified as MultiPolygon).coordinates;
  return result.length === 1 ? { type: "Polygon", coordinates: result[0] as Position[][] } : { type: "MultiPolygon", coordinates: result };
}

/**
 * This function gives the buffer of a GeoJSON geometry: the area within a distance in kilometres of the geometry, as a
 * polygon for a map. The module documentation gives the rules and the guarantee of the tolerance.
 *
 * @param distance - The distance in kilometres, more than 0.
 * @param options - The tolerance in kilometres and the limit of the cells.
 * @param radiusKm - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_KM`.
 * @throws GeoError - The codes of `parseGeometry`, `longitude-range`, `radius`, `not-finite`, `tolerance`, `max-cells`
 *   and `too-many-cells`.
 */
export function bufferKm(
  geometry: Geometry,
  distance: number,
  options: BufferOptions = {},
  radiusKm: number = EARTH_MEAN_RADIUS_KM,
): Polygon | MultiPolygon {
  return buffer(geometry, distance, radiusKm, options);
}

/**
 * This function gives the buffer of a GeoJSON geometry: the area within a distance in metres of the geometry, as a
 * polygon for a map. It uses the rules of `bufferKm`.
 *
 * @param distance - The distance in metres, more than 0.
 * @param options - The tolerance in metres and the limit of the cells.
 * @param radiusMeters - The radius of the sphere, more than 0. The default is `EARTH_MEAN_RADIUS_METERS`.
 * @throws GeoError - As `bufferKm`.
 */
export function bufferMeters(
  geometry: Geometry,
  distance: number,
  options: BufferOptions = {},
  radiusMeters: number = EARTH_MEAN_RADIUS_METERS,
): Polygon | MultiPolygon {
  return buffer(geometry, distance, radiusMeters, options);
}
