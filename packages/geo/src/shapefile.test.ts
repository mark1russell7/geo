import { describe, expect, it } from "vitest";
import { GeoError } from "./errors.ts";
import { locatePoint } from "./polygon.ts";
import {
  dbfRecordOffset,
  readDbfHeader,
  readDbfRecord,
  readShpHeader,
  readShpRecord,
  shapeGeometry,
  shapeKind,
  shpRecordBytes,
  SHP_HEADER_BYTES,
} from "./shapefile.ts";

type Ring = readonly (readonly [number, number])[];

/** This helper writes a polygon record: the record header (big-endian) and the content (little-endian). */
function polygonRecord(number: number, rings: readonly Ring[], shapeType = 5): Uint8Array {
  const points = rings.flat();
  const content = 44 + rings.length * 4 + points.length * 16;
  const bytes = new Uint8Array(8 + content);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, number, false);
  view.setInt32(4, content / 2, false);
  view.setInt32(8, shapeType, true);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) => view.setFloat64(12 + i * 8, v, true));
  view.setInt32(44, rings.length, true);
  view.setInt32(48, points.length, true);
  let start = 0;
  rings.forEach((ring, i) => {
    view.setInt32(52 + i * 4, start, true);
    start += ring.length;
  });
  const at = 52 + rings.length * 4;
  points.forEach((p, i) => {
    view.setFloat64(at + i * 16, p[0], true);
    view.setFloat64(at + i * 16 + 8, p[1], true);
  });
  return bytes;
}

function pointRecord(number: number, x: number, y: number): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, number, false);
  view.setInt32(4, 10, false);
  view.setInt32(8, 1, true);
  view.setFloat64(12, x, true);
  view.setFloat64(20, y, true);
  return bytes;
}

function multipointRecord(number: number, points: readonly (readonly [number, number])[]): Uint8Array {
  const content = 40 + points.length * 16;
  const bytes = new Uint8Array(8 + content);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, number, false);
  view.setInt32(4, content / 2, false);
  view.setInt32(8, 8, true);
  view.setInt32(44, points.length, true);
  points.forEach((p, i) => {
    view.setFloat64(48 + i * 16, p[0], true);
    view.setFloat64(56 + i * 16, p[1], true);
  });
  return bytes;
}

function nullRecord(number: number): Uint8Array {
  const bytes = new Uint8Array(12);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, number, false);
  view.setInt32(4, 2, false);
  return bytes;
}

function shp(shapeType: number, records: readonly Uint8Array[]): Uint8Array {
  const length = SHP_HEADER_BYTES + records.reduce((sum, r) => sum + r.length, 0);
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, length / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, shapeType, true);
  [-73, 42, -71, 44].forEach((v, i) => view.setFloat64(36 + i * 8, v, true));
  let at = SHP_HEADER_BYTES;
  for (const record of records) {
    bytes.set(record, at);
    at += record.length;
  }
  return bytes;
}

/** This helper writes a dbf file with the fields and the rows. The first byte of a row is its deletion flag. */
function dbf(fields: readonly [string, string, number, number][], rows: readonly (readonly [boolean, readonly string[]])[]): Uint8Array {
  const headerBytes = 32 + fields.length * 32 + 1;
  const recordBytes = 1 + fields.reduce((sum, f) => sum + f[2], 0);
  const bytes = new Uint8Array(headerBytes + rows.length * recordBytes + 1);
  const view = new DataView(bytes.buffer);
  bytes[0] = 3;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerBytes, true);
  view.setUint16(10, recordBytes, true);
  fields.forEach(([name, type, length, decimals], i) => {
    const at = 32 + i * 32;
    for (let c = 0; c < name.length; c++) bytes[at + c] = name.charCodeAt(c);
    bytes[at + 11] = type.charCodeAt(0);
    bytes[at + 16] = length;
    bytes[at + 17] = decimals;
  });
  bytes[headerBytes - 1] = 0x0d;
  rows.forEach(([deleted, values], r) => {
    let at = headerBytes + r * recordBytes;
    bytes[at++] = deleted ? 0x2a : 0x20;
    values.forEach((value, f) => {
      const length = fields[f]?.[2] ?? 0;
      const text = fields[f]?.[1] === "C" ? value.padEnd(length) : value.padStart(length);
      for (let c = 0; c < length; c++) bytes[at + c] = text.charCodeAt(c);
      at += length;
    });
  });
  bytes[bytes.length - 1] = 0x1a;
  return bytes;
}

// The outer ring turns clockwise and the hole turns counterclockwise, as the specification gives them.
const outer: Ring = [[-72, 43], [-72, 44], [-71, 44], [-71, 43], [-72, 43]];
const hole: Ring = [[-71.6, 43.4], [-71.4, 43.4], [-71.4, 43.6], [-71.6, 43.6], [-71.6, 43.4]];

describe("readShpHeader", () => {
  it("reads the shape type, the length and the box of the file", () => {
    const bytes = shp(5, [polygonRecord(1, [outer])]);
    expect(readShpHeader(bytes)).toEqual({ shapeType: 5, fileBytes: bytes.length, bbox: [-73, 42, -71, 44] });
  });

  it("refuses bytes that are too short or that have another file code", () => {
    expect(() => readShpHeader(new Uint8Array(50))).toThrow(GeoError);
    const bytes = shp(5, []);
    bytes[3] = 0;
    expect(() => readShpHeader(bytes)).toThrow(/9994/);
  });
});

describe("readShpRecord", () => {
  const bytes = shp(5, [polygonRecord(1, [outer, hole]), nullRecord(2), polygonRecord(3, [outer], 15)]);

  it("walks the records with their lengths, and reads each part", () => {
    const records = [];
    for (let at = SHP_HEADER_BYTES; at < bytes.length; at += shpRecordBytes(bytes, at) ?? bytes.length) records.push(readShpRecord(bytes, at));
    expect(records.map((r) => [r.number, r.shapeType, r.parts.length])).toEqual([[1, 5, 2], [2, 0, 0], [3, 15, 1]]);
    expect(records[0]?.bbox).toEqual([-72, 43, -71, 44]);
    expect(records[0]?.parts[1]).toEqual(hole);
    expect(records[1]?.bbox).toBeNull();
  });

  it("gives no length when the record header is not in the chunk, and refuses a record cut by the chunk", () => {
    expect(shpRecordBytes(bytes.subarray(0, SHP_HEADER_BYTES + 4), SHP_HEADER_BYTES)).toBeNull();
    expect(() => readShpRecord(bytes.subarray(0, SHP_HEADER_BYTES + 40), SHP_HEADER_BYTES)).toThrow(/past the end/);
  });

  it("refuses a part index out of the points of its record", () => {
    const record = polygonRecord(1, [outer]);
    new DataView(record.buffer).setInt32(52, 9, true);
    expect(() => readShpRecord(record, 0)).toThrow(/index out of its points/);
  });

  it("reads a multipoint and a polyline", () => {
    const multi = readShpRecord(multipointRecord(4, [[-71, 43], [-70, 44]]), 0);
    expect(multi.parts).toEqual([[[-71, 43], [-70, 44]]]);
    expect(shapeGeometry(multi)).toEqual({ type: "MultiPoint", coordinates: [[-71, 43], [-70, 44]] });
    const line: Ring = [[-72, 43], [-71, 44]];
    expect(shapeGeometry(readShpRecord(polygonRecord(5, [line], 3), 0))).toEqual({ type: "LineString", coordinates: line });
    expect(shapeGeometry(readShpRecord(polygonRecord(6, [line, line], 13), 0))?.type).toBe("MultiLineString");
  });

  it("refuses a record that is shorter than its counts", () => {
    const record = multipointRecord(4, [[-71, 43]]);
    new DataView(record.buffer).setInt32(44, 5, true);
    expect(() => readShpRecord(record, 0)).toThrow(/shorter than its counts/);
    const polygon = polygonRecord(1, [outer]);
    new DataView(polygon.buffer).setInt32(48, 50, true);
    expect(() => readShpRecord(polygon, 0)).toThrow(/shorter than its counts/);
  });

  it("reads a point", () => {
    expect(readShpRecord(pointRecord(7, -71.5, 43.5), 0)).toEqual({ number: 7, shapeType: 1, bbox: [-71.5, 43.5, -71.5, 43.5], parts: [[[-71.5, 43.5]]] });
  });
});

describe("shapeGeometry", () => {
  it("puts a counterclockwise ring in the polygon before it, as a hole", () => {
    const geometry = shapeGeometry(readShpRecord(polygonRecord(1, [outer, hole]), 0));
    expect(geometry?.type).toBe("Polygon");
    if (geometry?.type !== "Polygon") return;
    expect(geometry.coordinates).toHaveLength(2);
    expect(locatePoint({ lat: 43.2, lon: -71.8 }, geometry)).toBe("inside");
    expect(locatePoint({ lat: 43.5, lon: -71.5 }, geometry)).toBe("outside");
  });

  it("makes a multipolygon of two outer rings", () => {
    const other: Ring = [[-70, 43], [-70, 44], [-69, 44], [-69, 43], [-70, 43]];
    expect(shapeGeometry(readShpRecord(polygonRecord(1, [outer, other]), 0))?.type).toBe("MultiPolygon");
  });

  it("starts a polygon with a counterclockwise ring when no polygon is before it", () => {
    const geometry = shapeGeometry(readShpRecord(polygonRecord(1, [hole, outer]), 0));
    expect(geometry?.type).toBe("MultiPolygon");
    expect(shapeGeometry({ number: 1, shapeType: 5, bbox: null, parts: [[]] })).toBeNull();
    expect(shapeGeometry({ number: 1, shapeType: 0, bbox: null, parts: [[[0, 0]]] })).toBeNull();
  });

  it("gives a point for a point record, and null for a null record", () => {
    expect(shapeGeometry(readShpRecord(pointRecord(1, -71, 43), 0))).toEqual({ type: "Point", coordinates: [-71, 43] });
    expect(shapeGeometry(readShpRecord(nullRecord(1), 0))).toBeNull();
  });
});

describe("shapeKind", () => {
  it("gives the base kind of each Z and M variant, and refuses an unknown type", () => {
    expect([1, 3, 5, 8, 13, 25, 28].map(shapeKind)).toEqual(["point", "polyline", "polygon", "multipoint", "polyline", "polygon", "multipoint"]);
    expect(() => shapeKind(31)).toThrow(GeoError);
    expect(() => shapeKind(2)).toThrow(GeoError);
  });
});

describe("readDbfRecord", () => {
  const bytes = dbf(
    [["name", "C", 10, 0], ["speed", "N", 8, 3], ["open", "L", 1, 0], ["since", "D", 8, 0]],
    [
      [false, ["Hilltop", "5.000", "T", "20260630"]],
      [true, ["Gone", "1.000", "F", "20250101"]],
      [false, ["", "", "?", ""]],
    ],
  );
  const header = readDbfHeader(bytes);

  it("reads the fields and their positions in each record", () => {
    expect(header.records).toBe(3);
    expect(header.fields.map((f) => [f.name, f.type, f.offset])).toEqual([["name", "C", 1], ["speed", "N", 11], ["open", "L", 19], ["since", "D", 20]]);
  });

  it("reads a record at its index, a deleted record as null, and each blank as null", () => {
    expect(readDbfRecord(bytes, header, dbfRecordOffset(header, 0))).toEqual({ name: "Hilltop", speed: 5, open: true, since: "2026-06-30" });
    expect(readDbfRecord(bytes, header, dbfRecordOffset(header, 1))).toBeNull();
    expect(readDbfRecord(bytes, header, dbfRecordOffset(header, 2))).toEqual({ name: "", speed: null, open: null, since: null });
  });

  it("reads overflow and text in a number as null, F and N as false, and another type as text", () => {
    const other = dbf(
      [["count", "N", 4, 0], ["ratio", "F", 4, 0], ["open", "L", 1, 0], ["memo", "M", 6, 0]],
      [
        [false, ["****", "abc", "N", "12    "]],
        [false, ["7", "0.5", "f", "x     "]],
      ],
    );
    const h = readDbfHeader(other);
    expect(readDbfRecord(other, h, dbfRecordOffset(h, 0))).toEqual({ count: null, ratio: null, open: false, memo: "12" });
    expect(readDbfRecord(other, h, dbfRecordOffset(h, 1))).toEqual({ count: 7, ratio: 0.5, open: false, memo: "x" });
  });

  it("refuses fields that are longer than a record", () => {
    const bytes2 = dbf([["name", "C", 10, 0]], [[false, ["a"]]]);
    new DataView(bytes2.buffer).setUint16(10, 4, true);
    expect(() => readDbfHeader(bytes2)).toThrow(/need 11 bytes/);
  });

  it("refuses a record past the end of the input, and a header longer than the input", () => {
    expect(() => readDbfRecord(bytes, header, dbfRecordOffset(header, 3))).toThrow(/past the end/);
    expect(() => readDbfHeader(bytes.subarray(0, 40))).toThrow(GeoError);
  });
});
