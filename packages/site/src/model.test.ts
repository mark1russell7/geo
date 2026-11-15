import { describe, expect, it } from "vitest";
import {
  addCorner,
  areaOf,
  boxRing,
  bufferRing,
  bufferSentence,
  closeDraft,
  codeLines,
  densify,
  formatKm,
  formatLat,
  formatLon,
  LONGITUDE_LIMIT,
  PRESETS,
  presetOf,
  readout,
  sentence,
  unwrapLon,
} from "./model.ts";

const preset = (id: string) => {
  const found = presetOf(id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe("the presets", () => {
  it("has the three areas, each with a closed ring", () => {
    expect(PRESETS.map((one) => one.id)).toEqual(["antimeridian", "long-way", "pole"]);
    for (const one of PRESETS) expect(one.ring[0]).toEqual(one.ring[one.ring.length - 1]);
  });

  it("puts the place of the antimeridian area inside it", () => {
    const one = preset("antimeridian");
    const result = readout(one.place, areaOf(one.ring), 600, 3);
    expect(result.location).toBe("inside");
    expect(sentence(result)).toBe("The place is inside the area.");
  });

  it("puts the same place outside the long way round, in the gap of the area", () => {
    const one = preset("long-way");
    const result = readout(one.place, areaOf(one.ring), 600, 3);
    expect(result.location).toBe("outside");
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.distanceKm).toBeGreaterThan(900);
    expect(result.distanceKm).toBeLessThan(1200);
    expect(sentence(result)).toMatch(/^The place is outside the area, [\d,.]+ km from its edge\.$/);
  });

  it("gives a box across the antimeridian for the first area and a wide box for the long way", () => {
    const across = readout(preset("antimeridian").place, areaOf(preset("antimeridian").ring), 0, 3).box;
    expect(across).toBeDefined();
    expect(across?.west).toBeGreaterThan(across?.east ?? 0);
    const long = readout(preset("long-way").place, areaOf(preset("long-way").ring), 0, 3).box;
    expect(long?.west).toBeLessThan(long?.east ?? 0);
    expect((long?.east ?? 0) - (long?.west ?? 0)).toBeGreaterThan(300);
  });

  it("puts the place of the pole area inside it", () => {
    const one = preset("pole");
    expect(readout(one.place, areaOf(one.ring), 0, 3).location).toBe("inside");
    expect(readout({ lat: 60, lon: -40 }, areaOf(one.ring), 0, 3).location).toBe("outside");
  });

  it("gives undefined for an unknown id", () => {
    expect(presetOf("none")).toBeUndefined();
  });
});

describe("a drawn area", () => {
  it("takes the short way across the antimeridian", () => {
    expect(unwrapLon(179, -179)).toBe(181);
    expect(unwrapLon(-179, 179)).toBe(-181);
    expect(unwrapLon(10, 20)).toBe(20);
    const draft = [[170, 0], [179, 5]].reduce<[number, number][]>((ring, [lon, lat]) => addCorner(ring, { lat: lat as number, lon: lon as number }) as [number, number][], []);
    expect(addCorner(draft, { lat: 0, lon: -175 })?.[2]).toEqual([185, 0]);
  });

  it("refuses a corner past the longitude limit of geo", () => {
    expect(addCorner([[LONGITUDE_LIMIT - 10, 0]], { lat: 0, lon: -150 })).toBeUndefined();
  });

  it("closes a ring of 3 or more corners", () => {
    expect(closeDraft([[0, 0], [1, 0]])).toBeUndefined();
    expect(closeDraft([[0, 0], [1, 0], [1, 1]])).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
  });

  it("gives the same location for a ring and the reversed ring", () => {
    const ring = closeDraft([[178, -5], [185, -5], [185, 5], [178, 5]]) ?? [];
    const place = { lat: 0, lon: -178 };
    expect(readout(place, areaOf(ring), 0, 3).location).toBe("inside");
    expect(readout(place, areaOf([...ring].reverse()), 0, 3).location).toBe("inside");
  });
});

describe("the drawing helpers", () => {
  it("densifies each edge to steps of 1 degree or less, with the corners kept", () => {
    const line = densify([[0, 0], [3, 0], [3, 0.5]]);
    expect(line).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [3, 0.5]]);
  });

  it("draws a box across the antimeridian from west to east past 180", () => {
    const ring = boxRing({ west: 170, south: -10, east: -170, north: 10 });
    expect(ring[0]).toEqual([170, 10]);
    expect(Math.max(...ring.map(([lon]) => lon))).toBe(190);
  });

  it("gives a closed buffer ring at the radius", () => {
    const ring = bufferRing({ lat: 0, lon: 0 }, 111.19, 8);
    expect(ring).toHaveLength(9);
    expect(ring[0]?.[1]).toBeCloseTo(1, 2);
    expect(ring[8]?.[0]).toBeCloseTo(ring[0]?.[0] ?? Number.NaN, 9);
  });
});

describe("the readout", () => {
  it("says when the buffer meets the area", () => {
    const one = preset("long-way");
    const area = areaOf(one.ring);
    const near = readout(one.place, area, 2000, 3);
    expect(near.meets).toBe(true);
    expect(bufferSentence(near)).toBe("A buffer of 2,000 km round the place meets the area.");
    const far = readout(one.place, area, 0, 3);
    expect(far.meets).toBe(false);
    expect(bufferSentence(far)).toBe("A buffer of 0 km round the place does not meet the area.");
  });

  it("gives the geohash cell of the place, with its 8 neighbors", () => {
    const result = readout({ lat: -18, lon: 179.5 }, areaOf(preset("antimeridian").ring), 0, 4);
    expect(result.hash).toHaveLength(4);
    expect(result.neighbors).toHaveLength(8);
    expect(result.cell.south).toBeLessThanOrEqual(-18);
    expect(result.cell.north).toBeGreaterThanOrEqual(-18);
  });

  it("gives fewer neighbors at a pole", () => {
    const result = readout({ lat: 89.9, lon: 0 }, areaOf(preset("pole").ring), 0, 2);
    expect(result.neighbors.length).toBeLessThan(8);
  });

  it("gives a line of code for each value", () => {
    const result = readout(preset("antimeridian").place, areaOf(preset("antimeridian").ring), 0, 3);
    const lines = codeLines(result, 3);
    expect(lines.map((line) => line.code)).toEqual(["locatePoint(place, area)", "distanceToGeometryKm(place, area)", "geohash(place, 3)", "bboxOfGeoJson(area)"]);
    expect(lines[0]?.value).toBe('"inside"');
    expect(lines[2]?.value).toBe(JSON.stringify(result.hash));
  });
});

describe("the formats", () => {
  it("writes latitudes, longitudes and distances", () => {
    expect(formatLat(-18)).toBe("18.00° S");
    expect(formatLat(0.5)).toBe("0.50° N");
    expect(formatLon(181.5)).toBe("178.50° W");
    expect(formatLon(-200)).toBe("160.00° E");
    expect(formatKm(0)).toBe("0 km");
    expect(formatKm(42.25)).toBe("42.3 km");
    expect(formatKm(1234.4)).toBe("1,234 km");
  });
});
