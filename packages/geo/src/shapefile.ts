/**
 * Shapefiles, as the ESRI Shapefile Technical Description (1998) gives them: the `.shp` file of the shapes and the
 * `.dbf` file (dBASE III) of their attributes.
 *
 * - Each function reads bytes and does no I/O. A caller reads a large file in chunks, after its header.
 * - `shpRecordBytes` gives the length of the record at an offset. Thus the caller knows how many bytes to read.
 * - `readDbfRecord` reads one record at a known index, because each `.dbf` record has the same length. Thus a caller
 *   reads only the attributes of the shapes that it keeps.
 * - `shapeGeometry` gives a GeoJSON geometry of a record. The readers take the Z and M variants, and they keep only
 *   x and y.
 * - The coordinates are the coordinates of the file. The `.prj` file names the coordinate system. This entry does not
 *   change it.
 *
 * @packageDocumentation
 */

import { GeoError } from "./errors.ts";
import type { LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon } from "./geojson.ts";
import type { Position } from "./point.ts";
import { rewind, ringWinding } from "./polygon.ts";

/** The length of the header of a `.shp` file and of a `.shx` file, in bytes. */
export const SHP_HEADER_BYTES = 100;

/** The length of the header of each `.shp` record (the record number and the content length), in bytes. */
export const SHP_RECORD_HEADER_BYTES = 8;

/** The shape types of the specification. The Z and M variants keep the layout of x and y of the base type. */
export const SHAPE_TYPES = {
  null: 0,
  point: 1,
  polyline: 3,
  polygon: 5,
  multipoint: 8,
  pointZ: 11,
  polylineZ: 13,
  polygonZ: 15,
  multipointZ: 18,
  pointM: 21,
  polylineM: 23,
  polygonM: 25,
  multipointM: 28,
} as const;

/** The kind of a shape type, without its Z or M variant. */
export type ShapeKind = "null" | "point" | "polyline" | "polygon" | "multipoint";

/** A box of a shapefile: `[xmin, ymin, xmax, ymax]`. */
export type ShapeBox = readonly [number, number, number, number];

/** The header of a `.shp` file or of a `.shx` file. */
export interface ShpHeader {
  /** The shape type of the file. Each record has this type or the type 0 (null). */
  readonly shapeType: number;
  /** The length of the file, in bytes, as the header gives it. */
  readonly fileBytes: number;
  /** The box of all the shapes of the file. */
  readonly bbox: ShapeBox;
}

/** One record of a `.shp` file. */
export interface ShpRecord {
  /** The record number. The first record has the number 1. Record `n` has the attributes of `.dbf` record `n - 1`. */
  readonly number: number;
  /** The shape type of the record. */
  readonly shapeType: number;
  /** The box of the shape, or `null` for a null shape. A point has a box of zero size. */
  readonly bbox: ShapeBox | null;
  /**
   * The parts of the shape, as positions `[x, y]`. A point has one part with one position. A multipoint has one part
   * with each point. A polyline has a part for each line, and a polygon has a part for each ring.
   */
  readonly parts: readonly (readonly Position[])[];
}

/** One field of a `.dbf` file. */
export interface DbfField {
  /** The name of the field. */
  readonly name: string;
  /** The type letter of the field, for example `C` (text), `N` (number), `F` (float), `L` (logical) or `D` (date). */
  readonly type: string;
  /** The length of the field in each record, in bytes. */
  readonly length: number;
  /** The count of the decimal places of a number. */
  readonly decimals: number;
  /** The position of the field in each record, in bytes. The first byte of a record is the deletion flag. */
  readonly offset: number;
}

/** The header of a `.dbf` file. */
export interface DbfHeader {
  /** The count of the records. */
  readonly records: number;
  /** The length of the header, in bytes. The first record starts at this position. */
  readonly headerBytes: number;
  /** The length of each record, in bytes. */
  readonly recordBytes: number;
  readonly fields: readonly DbfField[];
}

/** The value of a field: a text, a number, a logical value, a date `YYYY-MM-DD` as text, or `null` for a blank. */
export type DbfValue = string | number | boolean | null;

/** This function gives the kind of a shape type. It throws a `GeoError` with the code `shapefile` for an unknown type. */
export function shapeKind(shapeType: number): ShapeKind {
  if (shapeType === 0) return "null";
  const kinds: Readonly<Record<number, ShapeKind>> = { 1: "point", 3: "polyline", 5: "polygon", 8: "multipoint" };
  const kind = shapeType >= 1 && shapeType <= 28 ? kinds[shapeType % 10] : undefined;
  if (kind === undefined) throw new GeoError("shapefile", `the shape type ${shapeType} is not a type of the specification`);
  return kind;
}

/**
 * This function reads the header of a `.shp` file or of a `.shx` file from its first 100 bytes. It throws a `GeoError`
 * with the code `shapefile` when the bytes are too short or the file code is not 9994.
 */
export function readShpHeader(bytes: Uint8Array): ShpHeader {
  if (bytes.length < SHP_HEADER_BYTES) throw new GeoError("shapefile", `the header needs ${SHP_HEADER_BYTES} bytes, and the input has ${bytes.length}`);
  const view = viewOf(bytes);
  if (view.getInt32(0, false) !== 9994) throw new GeoError("shapefile", "the file code is not 9994, so the bytes are not a shapefile");
  const shapeType = view.getInt32(32, true);
  shapeKind(shapeType);
  return {
    shapeType,
    fileBytes: view.getInt32(24, false) * 2,
    bbox: [view.getFloat64(36, true), view.getFloat64(44, true), view.getFloat64(52, true), view.getFloat64(60, true)],
  };
}

/**
 * This function gives the length of the `.shp` record at `offset`, with its 8-byte header, in bytes. It gives `null`
 * when the 8 bytes of the record header are not all in `bytes`. A caller that reads in chunks reads this many bytes
 * from `offset` before it uses `readShpRecord`.
 */
export function shpRecordBytes(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + SHP_RECORD_HEADER_BYTES > bytes.length) return null;
  return SHP_RECORD_HEADER_BYTES + viewOf(bytes).getInt32(offset + 4, false) * 2;
}

/**
 * This function reads the `.shp` record at `offset`. It throws a `GeoError` with the code `shapefile` in two cases.
 * The record is not all in `bytes`, or its counts do not agree with its length.
 */
export function readShpRecord(bytes: Uint8Array, offset: number): ShpRecord {
  const length = shpRecordBytes(bytes, offset);
  if (length === null || offset + length > bytes.length) throw new GeoError("shapefile", `the record at the byte ${offset} goes past the end of the input`);
  const view = viewOf(bytes);
  const number = view.getInt32(offset, false);
  const at = offset + SHP_RECORD_HEADER_BYTES;
  const end = offset + length;
  const need = (bytesNeeded: number): void => {
    if (bytesNeeded > end) throw new GeoError("shapefile", `the record ${number} is shorter than its counts`);
  };
  need(at + 4);
  const shapeType = view.getInt32(at, true);
  const position = (p: number): Position => [view.getFloat64(p, true), view.getFloat64(p + 8, true)];
  const box = (p: number): ShapeBox => [view.getFloat64(p, true), view.getFloat64(p + 8, true), view.getFloat64(p + 16, true), view.getFloat64(p + 24, true)];
  switch (shapeKind(shapeType)) {
    case "null":
      return { number, shapeType, bbox: null, parts: [] };
    case "point": {
      need(at + 20);
      const [x, y] = position(at + 4);
      return { number, shapeType, bbox: [x, y, x, y] as ShapeBox, parts: [[[x, y]]] };
    }
    case "multipoint": {
      need(at + 40);
      const count = view.getInt32(at + 36, true);
      need(at + 40 + count * 16);
      const points: Position[] = [];
      for (let i = 0; i < count; i++) points.push(position(at + 40 + i * 16));
      return { number, shapeType, bbox: box(at + 4), parts: [points] };
    }
    case "polyline":
    case "polygon": {
      need(at + 44);
      const partCount = view.getInt32(at + 36, true);
      const pointCount = view.getInt32(at + 40, true);
      const pointsAt = at + 44 + partCount * 4;
      need(pointsAt + pointCount * 16);
      const startOf = (i: number): number => view.getInt32(at + 44 + i * 4, true);
      const parts: Position[][] = [];
      for (let i = 0; i < partCount; i++) {
        const from = startOf(i);
        const to = i + 1 < partCount ? startOf(i + 1) : pointCount;
        if (from < 0 || to > pointCount || from > to) throw new GeoError("shapefile", `the part ${i} of the record ${number} has an index out of its points`);
        const part: Position[] = [];
        for (let p = from; p < to; p++) part.push(position(pointsAt + p * 16));
        parts.push(part);
      }
      return { number, shapeType, bbox: box(at + 4), parts };
    }
  }
}

/**
 * This function gives the GeoJSON geometry of a record, or `null` for a null shape or a shape with no part.
 *
 * - A polygon ring that turns clockwise starts a polygon, as the specification gives it.
 * - A ring that turns counterclockwise is a hole of the polygon before it. A hole before each outer ring starts its own polygon.
 * - The polygons follow the right-hand rule of RFC 7946, as `rewind` gives it.
 */
export function shapeGeometry(record: ShpRecord): Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon | null {
  const parts = record.parts.filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  switch (shapeKind(record.shapeType)) {
    case "null":
      return null;
    case "point":
      return { type: "Point", coordinates: (parts[0] as readonly Position[])[0] as Position };
    case "multipoint":
      return { type: "MultiPoint", coordinates: parts[0] as readonly Position[] };
    case "polyline":
      return parts.length === 1 ? { type: "LineString", coordinates: parts[0] as readonly Position[] } : { type: "MultiLineString", coordinates: parts };
    case "polygon": {
      const polygons: (readonly Position[])[][] = [];
      for (const ring of parts) {
        const last = polygons.at(-1);
        if (ringWinding(ring) === "counterclockwise" && last !== undefined) last.push(ring);
        else polygons.push([ring]);
      }
      const geometry: Polygon | MultiPolygon =
        polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] as (readonly Position[])[] } : { type: "MultiPolygon", coordinates: polygons };
      return rewind(geometry);
    }
  }
}

/**
 * This function reads the header of a `.dbf` file. The bytes must hold the whole header: 32 bytes, then 32 bytes for
 * each field, then the byte 0x0D. It throws a `GeoError` with the code `shapefile` for a short or incorrect header.
 */
export function readDbfHeader(bytes: Uint8Array): DbfHeader {
  if (bytes.length < 32) throw new GeoError("shapefile", `the header of a dbf file needs 32 bytes or more, and the input has ${bytes.length}`);
  const view = viewOf(bytes);
  const records = view.getUint32(4, true);
  const headerBytes = view.getUint16(8, true);
  const recordBytes = view.getUint16(10, true);
  if (bytes.length < headerBytes) throw new GeoError("shapefile", `the header of the dbf file has ${headerBytes} bytes, and the input has ${bytes.length}`);
  const fields: DbfField[] = [];
  let offset = 1;
  for (let at = 32; at + 32 <= headerBytes && view.getUint8(at) !== 0x0d; at += 32) {
    const length = view.getUint8(at + 16);
    fields.push({ name: beforeNul(latin1(bytes, at, at + 11)), type: String.fromCharCode(view.getUint8(at + 11)), length, decimals: view.getUint8(at + 17), offset });
    offset += length;
  }
  if (offset > recordBytes) throw new GeoError("shapefile", `the fields need ${offset} bytes in each record, and a record has ${recordBytes}`);
  return { records, headerBytes, recordBytes, fields };
}

/** This function gives the position of the `.dbf` record `index` in the file, in bytes. The first record has the index 0. */
export function dbfRecordOffset(header: DbfHeader, index: number): number {
  return header.headerBytes + index * header.recordBytes;
}

/**
 * This function reads the `.dbf` record that starts at `offset` of `bytes`. It gives `null` for a deleted record. Text
 * is read as Latin-1, with the spaces at its end removed. A blank number, logical value or date is `null`.
 */
export function readDbfRecord(bytes: Uint8Array, header: DbfHeader, offset: number): Readonly<Record<string, DbfValue>> | null {
  if (offset < 0 || offset + header.recordBytes > bytes.length) throw new GeoError("shapefile", `the dbf record at the byte ${offset} goes past the end of the input`);
  if (bytes[offset] === 0x2a) return null;
  const values: Record<string, DbfValue> = {};
  for (const field of header.fields) {
    const text = latin1(bytes, offset + field.offset, offset + field.offset + field.length);
    values[field.name] = dbfValue(field.type, text);
  }
  return values;
}

function dbfValue(type: string, text: string): DbfValue {
  const value = text.trim();
  switch (type) {
    case "N":
    case "F": {
      if (value === "" || /^\*+$/.test(value)) return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    }
    case "L":
      return /^[TtYy]$/.test(value) ? true : /^[FfNn]$/.test(value) ? false : null;
    case "D":
      return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
    default:
      return trimEnd(text);
  }
}

/** This function removes the spaces and the NUL bytes at the end of a text, with no regular expression. */
function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) <= 0x20) end--;
  return text.slice(0, end);
}

/** This function gives the text before the first NUL byte. */
function beforeNul(text: string): string {
  const at = text.indexOf("\u0000");
  return at < 0 ? text : text.slice(0, at);
}

function latin1(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.subarray(from, to));
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
