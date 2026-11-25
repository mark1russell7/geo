import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { followsRightHandRule, GeoError, gridRegion, locatePoint, type MultiPolygon, type Polygon, type ValueGrid } from "./index.ts";

/** This function makes a grid from rows of values, the south row first, with one degree between two points. */
function gridOf(rows: readonly (readonly (number | null)[])[], west = 10, south = 20): ValueGrid {
  const columns = (rows[0] as readonly unknown[]).length;
  return {
    x: { start: west, stop: west + columns - 1, num: columns },
    y: { start: south, stop: south + rows.length - 1, num: rows.length },
    values: rows.flat(),
  };
}

const at = (region: Polygon | MultiPolygon, lon: number, lat: number): string => locatePoint({ lat, lon }, region);
const polygonCount = (region: Polygon | MultiPolygon): number => (region.type === "Polygon" ? 1 : region.coordinates.length);

describe("gridRegion", () => {
  it("gives a ring around one high point, counterclockwise", () => {
    const region = gridRegion(gridOf([[0, 0, 0], [0, 8, 0], [0, 0, 0]]), 4);
    expect(region.type).toBe("Polygon");
    expect(followsRightHandRule(region)).toBe(true);
    expect(at(region, 11, 21)).toBe("inside");
    // The value changes linearly: at the level 4, the boundary is halfway from the high point to each neighbor.
    expect(at(region, 11.4, 21)).toBe("inside");
    expect(at(region, 11.6, 21)).toBe("outside");
    expect(at(region, 10, 20)).toBe("outside");
  });

  it("gives the box of the grid when each value is at the level or more, and no polygon when none is", () => {
    expect(gridRegion(gridOf([[5, 5], [5, 6]]), 5)).toEqual({ type: "Polygon", coordinates: [[[10, 20], [11, 20], [11, 21], [10, 21], [10, 20]]] });
    expect(gridRegion(gridOf([[1, 2], [3, 4]]), 5)).toEqual({ type: "MultiPolygon", coordinates: [] });
  });

  it("goes along the edge of the grid where the region touches it", () => {
    const region = gridRegion(gridOf([[0, 0, 9, 9], [0, 0, 9, 9], [0, 0, 9, 9]]), 4.5);
    expect(at(region, 12.5, 21)).toBe("inside");
    expect(at(region, 13, 21)).toBe("boundary");
    expect(at(region, 10.5, 21)).toBe("outside");
    // The boundary crosses the cell from the value 0 to the value 9 at its middle.
    expect(at(region, 11.45, 21)).toBe("outside");
    expect(at(region, 11.55, 21)).toBe("inside");
  });

  it("gives a hole around a low point", () => {
    const region = gridRegion(gridOf([[9, 9, 9], [9, 0, 9], [9, 9, 9]]), 4);
    expect(region.type).toBe("Polygon");
    expect((region as Polygon).coordinates).toHaveLength(2);
    expect(followsRightHandRule(region)).toBe(true);
    expect(at(region, 11, 21)).toBe("outside");
    expect(at(region, 10.2, 20.2)).toBe("inside");
  });

  it("gives two polygons for two high points on a diagonal when the center is low", () => {
    // The center of the cell is the mean of its corners: (9 + 9 + 0 + 0) / 4 = 4.5. It is less than the level 5.
    const apart = gridRegion(gridOf([[9, 0], [0, 9]]), 5);
    expect(polygonCount(apart)).toBe(2);
    const joined = gridRegion(gridOf([[9, 0], [0, 9]]), 4);
    expect(polygonCount(joined)).toBe(1);
  });

  it("gives the same region for reversed axes", () => {
    const rows = [[0, 1, 2], [3, 9, 4], [5, 6, 7]];
    const forward = gridRegion(gridOf(rows), 4.5);
    const reversed: ValueGrid = {
      x: { start: 12, stop: 10, num: 3 },
      y: { start: 22, stop: 20, num: 3 },
      values: [...rows].reverse().flatMap((row) => [...row].reverse()),
    };
    expect(gridRegion(reversed, 4.5)).toEqual(forward);
  });

  it("puts no point with no value in the region", () => {
    const region = gridRegion(gridOf([[9, 9, 9], [9, null, 9], [9, Number.NaN, 9]]), 4);
    expect(at(region, 11, 21)).toBe("outside");
    expect(at(region, 10.1, 20.1)).toBe("inside");
  });

  it("puts each point of the grid at the level or more in the region, and each other point out of it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 2, max: 6 }),
        fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 36, maxLength: 36 }),
        fc.integer({ min: 0, max: 9 }),
        (columns, rows, pool, level) => {
          const values = pool.slice(0, columns * rows);
          const grid: ValueGrid = { x: { start: 0, stop: columns - 1, num: columns }, y: { start: 0, stop: rows - 1, num: rows }, values };
          const region = gridRegion(grid, level);
          if (polygonCount(region) > 0) expect(followsRightHandRule(region)).toBe(true);
          for (let j = 0; j < rows; j += 1) {
            for (let i = 0; i < columns; i += 1) {
              const value = values[j * columns + i] as number;
              const edge = i === 0 || j === 0 || i === columns - 1 || j === rows - 1;
              const where = polygonCount(region) === 0 ? "outside" : at(region, i, j);
              if (value < level) expect(where).toBe("outside");
              else expect(where).toBe(edge ? "boundary" : "inside");
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("simplifies the rings with a tolerance, and keeps the positions on the edge of the grid", () => {
    const rows = Array.from({ length: 40 }, (_, j) => Array.from({ length: 40 }, (_, i) => 100 - Math.hypot(i - 19.5, j - 19.5) * 5));
    const grid: ValueGrid = { x: { start: 0, stop: 3.9, num: 40 }, y: { start: 0, stop: 3.9, num: 40 }, values: rows.flat() };
    const full = gridRegion(grid, 50) as Polygon;
    const simple = gridRegion(grid, 50, { toleranceKm: 5 }) as Polygon;
    expect(simple.coordinates[0]?.length).toBeLessThan(full.coordinates[0]?.length as number);
    expect(followsRightHandRule(simple)).toBe(true);
    expect(at(simple, 1.95, 1.95)).toBe("inside");
  });

  it.each([
    ["a level that is not finite", gridOf([[1, 2], [3, 4]]), Number.NaN, "not-finite"],
    ["an axis with one value", { x: { start: 0, stop: 1, num: 1 }, y: { start: 0, stop: 1, num: 2 }, values: [1, 2] }, 1, "geojson-member"],
    ["a count of values that the axes do not give", { x: { start: 0, stop: 1, num: 2 }, y: { start: 0, stop: 1, num: 2 }, values: [1, 2, 3] }, 1, "geojson-member"],
    ["a longitude out of range", { x: { start: 170, stop: 190, num: 2 }, y: { start: 0, stop: 1, num: 2 }, values: [1, 2, 3, 4] }, 1, "longitude-range"],
  ] as const)("refuses %s", (_name, grid, level, code) => {
    expect(() => gridRegion(grid, level)).toThrow(GeoError);
    try {
      gridRegion(grid, level);
    } catch (error) {
      expect((error as GeoError).code).toBe(code);
    }
  });

  it("refuses a negative tolerance", () => {
    expect(() => gridRegion(gridOf([[1, 2], [3, 4]]), 1, { toleranceKm: -1 })).toThrow(GeoError);
  });
});
