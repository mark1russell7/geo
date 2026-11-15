/**
 * Geohashes: the cell of a point, the cell of a geohash, the neighbors of a cell, and the cells that cover a box. A
 * geohash interleaves the bits of the longitude and the latitude, and writes each group of five bits as one character
 * of a base-32 alphabet. The first bit is the longitude.
 *
 * @packageDocumentation
 */

import { checkBBox, type BBox } from "./bbox.ts";
import { GeoError } from "./errors.ts";
import { checkCoordinates, normalizeLon, type LatLon } from "./point.ts";

/** The base-32 alphabet of the geohash. It has no `a`, `i`, `l` or `o`. */
export const GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz";

/** The precision (the number of characters) when the caller gives none. At the equator, a cell of 7 characters is approximately 153 m by 153 m. */
export const DEFAULT_GEOHASH_PRECISION = 7;

/** The maximum precision. A cell of 12 characters is smaller than 4 cm by 4 cm. */
export const MAX_GEOHASH_PRECISION = 12;

/** The limit of `geohashesInBBox` when the caller gives none. */
export const DEFAULT_MAX_GEOHASH_CELLS = 10_000;

/** The cell of a geohash: its edges in degrees, and its center. */
export interface GeohashCell {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
  readonly center: LatLon;
}

/** A direction from a cell to a neighbor cell. */
export type GeohashDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** The eight neighbors of a cell. A neighbor past a pole is `undefined`. */
export type GeohashNeighbors = { readonly [direction in GeohashDirection]: string | undefined };

const STEPS: { readonly [direction in GeohashDirection]: readonly [lat: number, lon: number] } = {
  n: [1, 0],
  ne: [1, 1],
  e: [0, 1],
  se: [-1, 1],
  s: [-1, 0],
  sw: [-1, -1],
  w: [0, -1],
  nw: [1, -1],
};

/** The indices of a cell on its grid: the column of the longitude and the row of the latitude. */
interface CellIndex {
  readonly lon: number;
  readonly lat: number;
  readonly lonBits: number;
  readonly latBits: number;
}

const lonBitsOf = (precision: number): number => Math.ceil((precision * 5) / 2);
const latBitsOf = (precision: number): number => Math.floor((precision * 5) / 2);

function checkPrecision(precision: number): void {
  if (!Number.isInteger(precision) || precision < 1 || precision > MAX_GEOHASH_PRECISION) {
    throw new GeoError("geohash-precision", `The precision ${precision} is not an integer from 1 to ${MAX_GEOHASH_PRECISION}`);
  }
}

/** It halves the range `bits` times. A value on the middle of a range goes to the upper half. */
function bisect(value: number, low: number, high: number, bits: number): number {
  let index = 0;
  let lower = low;
  let upper = high;
  for (let bit = 0; bit < bits; bit += 1) {
    const mid = (lower + upper) / 2;
    if (value >= mid) {
      index = index * 2 + 1;
      lower = mid;
    } else {
      index *= 2;
      upper = mid;
    }
  }
  return index;
}

/** It gives a longitude in the range of the geohash. A longitude from -180 to 180 does not change. */
function geohashLon(lon: number): number {
  return lon >= -180 && lon <= 180 ? lon : normalizeLon(lon);
}

function encode(lonIndex: number, latIndex: number, precision: number): string {
  let lonBit = lonBitsOf(precision) - 1;
  let latBit = latBitsOf(precision) - 1;
  let hash = "";
  let value = 0;
  for (let bit = 0; bit < precision * 5; bit += 1) {
    if (bit % 2 === 0) {
      value = value * 2 + ((lonIndex >> lonBit) & 1);
      lonBit -= 1;
    } else {
      value = value * 2 + ((latIndex >> latBit) & 1);
      latBit -= 1;
    }
    if (bit % 5 === 4) {
      hash += GEOHASH_ALPHABET[value] as string;
      value = 0;
    }
  }
  return hash;
}

function decodeIndex(hash: string): CellIndex {
  if (hash.length === 0 || hash.length > MAX_GEOHASH_PRECISION) {
    throw new GeoError("geohash-length", `A geohash has 1 to ${MAX_GEOHASH_PRECISION} characters`);
  }
  let lon = 0;
  let lat = 0;
  let bit = 0;
  for (const char of hash.toLowerCase()) {
    const value = GEOHASH_ALPHABET.indexOf(char);
    if (value === -1) throw new GeoError("geohash-character", `"${char}" is not a character of a geohash`);
    for (let shift = 4; shift >= 0; shift -= 1) {
      const next = (value >> shift) & 1;
      if (bit % 2 === 0) lon = lon * 2 + next;
      else lat = lat * 2 + next;
      bit += 1;
    }
  }
  return { lon, lat, lonBits: lonBitsOf(hash.length), latBits: latBitsOf(hash.length) };
}

/**
 * This function gives the geohash of a point. A coordinate on the edge between two cells goes to the cell on the
 * north or on the east. A longitude out of the range from -180 to 180 is normalized first.
 *
 * @param precision - The number of characters, from 1 to 12. The default is `DEFAULT_GEOHASH_PRECISION`.
 * @throws GeoError - The code is `not-finite`, `latitude-range` or `geohash-precision`.
 */
export function geohash(point: LatLon, precision: number = DEFAULT_GEOHASH_PRECISION): string {
  checkCoordinates(point.lat, point.lon);
  checkPrecision(precision);
  const lonIndex = bisect(geohashLon(point.lon), -180, 180, lonBitsOf(precision));
  const latIndex = bisect(point.lat, -90, 90, latBitsOf(precision));
  return encode(lonIndex, latIndex, precision);
}

/**
 * This function gives the cell of a geohash: its edges and its center. Upper case letters are correct.
 *
 * @throws GeoError - The code is `geohash-length` or `geohash-character`. A `GeoError` is a `RangeError`.
 */
export function decodeGeohash(hash: string): GeohashCell {
  const index = decodeIndex(hash);
  const lonSize = 2 ** index.lonBits;
  const latSize = 2 ** index.latBits;
  const west = -180 + (360 * index.lon) / lonSize;
  const east = -180 + (360 * (index.lon + 1)) / lonSize;
  const south = -90 + (180 * index.lat) / latSize;
  const north = -90 + (180 * (index.lat + 1)) / latSize;
  return { south, west, north, east, center: { lat: (south + north) / 2, lon: (west + east) / 2 } };
}

/**
 * This function gives the neighbor of a cell in a direction, with the same precision. The longitude wraps at the
 * antimeridian. Past a pole, the result is `undefined`.
 *
 * @throws GeoError - The code is `geohash-length` or `geohash-character`.
 */
export function geohashNeighbor(hash: string, direction: GeohashDirection): string | undefined {
  const index = decodeIndex(hash);
  const step = STEPS[direction];
  const lat = index.lat + step[0];
  if (lat < 0 || lat >= 2 ** index.latBits) return undefined;
  const columns = 2 ** index.lonBits;
  const lon = (index.lon + step[1] + columns) % columns;
  return encode(lon, lat, hash.length);
}

/**
 * This function gives the eight neighbors of a cell. A neighbor past a pole is `undefined`.
 *
 * @throws GeoError - The code is `geohash-length` or `geohash-character`.
 */
export function geohashNeighbors(hash: string): GeohashNeighbors {
  return {
    n: geohashNeighbor(hash, "n"),
    ne: geohashNeighbor(hash, "ne"),
    e: geohashNeighbor(hash, "e"),
    se: geohashNeighbor(hash, "se"),
    s: geohashNeighbor(hash, "s"),
    sw: geohashNeighbor(hash, "sw"),
    w: geohashNeighbor(hash, "w"),
    nw: geohashNeighbor(hash, "nw"),
  };
}

/**
 * This function gives the geohashes of the cells that cover a closed box, with one precision. The list has each cell
 * that has a point of the box, with the rule of `geohash` for a point on an edge. So a cell that touches the box only
 * on its south edge or its west edge is not in the list. The order is from south to north, then from west to east. A
 * box that crosses the antimeridian is correct.
 *
 * @param precision - The number of characters, from 1 to 12.
 * @param maxCells - The limit of the number of cells. The default is `DEFAULT_MAX_GEOHASH_CELLS`.
 * @throws GeoError - The code is `too-many-cells` when the cover needs more cells than `maxCells`, or a code of the box
 *   or of the precision.
 */
export function geohashesInBBox(
  box: BBox,
  precision: number,
  maxCells: number = DEFAULT_MAX_GEOHASH_CELLS,
): readonly string[] {
  checkBBox(box, "box");
  checkPrecision(precision);
  if (Number.isNaN(maxCells) || maxCells < 0) {
    throw new GeoError("too-many-cells", `The limit ${maxCells} of cells must be a number of 0 or more`);
  }
  const lonBits = lonBitsOf(precision);
  const latBits = latBitsOf(precision);
  const lastColumn = 2 ** lonBits - 1;
  const westColumn = bisect(box.west, -180, 180, lonBits);
  const eastColumn = bisect(box.east, -180, 180, lonBits);
  const spans: readonly (readonly [number, number])[] =
    box.west <= box.east
      ? [[westColumn, eastColumn]]
      : [
          [westColumn, lastColumn],
          [0, eastColumn],
        ];
  const southRow = bisect(box.south, -90, 90, latBits);
  const northRow = bisect(box.north, -90, 90, latBits);
  const columns = spans.reduce((sum, [from, to]) => sum + (to - from + 1), 0);
  const count = (northRow - southRow + 1) * columns;
  if (count > maxCells) {
    throw new GeoError("too-many-cells", `The cover needs ${count} cells, and the limit is ${maxCells}`);
  }
  const hashes: string[] = [];
  for (let row = southRow; row <= northRow; row += 1) {
    for (const [from, to] of spans) {
      for (let column = from; column <= to; column += 1) hashes.push(encode(column, row, precision));
    }
  }
  return hashes;
}
