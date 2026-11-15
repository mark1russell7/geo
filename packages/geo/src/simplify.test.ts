import { classifySegments } from "@mark1russell7/predicates";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { distanceToGeometryKm } from "./distance.ts";
import { GeoError } from "./errors.ts";
import type { MultiPolygon, Polygon } from "./geojson.ts";
import type { Position } from "./point.ts";
import { locatePoint } from "./polygon.ts";
import { regionSimplifier, simplifyRegions, type Region } from "./simplify.ts";

type Ring = readonly Position[];

const keyOf = (position: Position): string => `${position[0]},${position[1]}`;

const polygonsOf = (region: Region): readonly (readonly Ring[])[] =>
  region.type === "Polygon" ? [region.coordinates] : region.coordinates;

const ringsOf = (region: Region): Ring[] => polygonsOf(region).flat();

/** The signed area of a ring in the plane of the longitudes and the latitudes, in square degrees. */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let index = 0; index + 1 < ring.length; index += 1) {
    const [x1, y1] = ring[index] as Position;
    const [x2, y2] = ring[index + 1] as Position;
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

const regionArea = (region: Region): number =>
  polygonsOf(region).reduce(
    (total, [exterior = [], ...holes]) => total + Math.abs(ringArea(exterior)) - holes.reduce((sum, hole) => sum + Math.abs(ringArea(hole)), 0),
    0,
  );

const reversed = (ring: Ring): Position[] => [...ring].reverse();

/** This function joins lines that each start at the end of the line before it. */
function join(lines: readonly Ring[]): Position[] {
  const joined: Position[] = [];
  for (const line of lines) joined.push(...line.slice(joined.length === 0 ? 0 : 1));
  return joined;
}

/**
 * A generated map: a grid of tiles with wiggly shared borders, islands in holes of the tiles, and a frame. The frame is
 * a square with the outline of the tiles as its hole. Thus the areas of all the regions sum to the area of the square
 * of the frame. Two tiles make one MultiPolygon. The values of `noise` are from -1 to 1.
 *
 * Some bottom borders have a deep bay with an island in it. A straight border across the bay puts the island in the
 * wrong tile, so these bays need the repair.
 */
function tiling(noise: readonly number[], columns: number, rows: number, origin: Position = [0, 0], step = 0.1): { regions: Region[]; area: number } {
  let cursor = 0;
  const next = (): number => noise[cursor++ % noise.length] as number;
  const [x0, y0] = origin;
  const lattice: Position[][] = [];
  for (let c = 0; c <= columns; c += 1) {
    lattice.push([]);
    for (let r = 0; r <= rows; r += 1) lattice[c]?.push([x0 + (c + 0.1 * next()) * step, y0 + (r + 0.1 * next()) * step]);
  }
  const at = (c: number, r: number): Position => lattice[c]?.[r] as Position;
  const islands: Position[][] = [];
  const holes = new Map<string, Position[][]>();
  const addIsland = (tile: string, ring: Position[]): void => {
    const closed = [...ring, ring[0] as Position];
    islands.push(closed);
    holes.set(tile, [...(holes.get(tile) ?? []), reversed(closed)]);
  };
  // A wiggly line. Its offsets are small near the ends, so the lines from one point of the grid do not cross. A line
  // with a bay goes down into a deep bay in its middle, and an island of the tile `bay` is in that bay.
  const wiggle = (from: Position, to: Position, bay?: string): Position[] => {
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
    const length = Math.hypot(dx, dy);
    // The position at the part `t` of the line, at the distance `offset` in degrees to its left.
    const point = (t: number, offset: number): Position => [from[0] + t * dx - (offset * dy) / length, from[1] + t * dy + (offset * dx) / length];
    const count = 2 + Math.floor(Math.abs(next()) * 10);
    const line: Position[] = [from];
    for (let m = 1; m <= count; m += 1) {
      const t = m / (count + 1);
      const offset = 0.15 * step * Math.sin(Math.PI * t) * next();
      if (bay === undefined || t < 0.35) line.push(point(t, offset));
    }
    if (bay !== undefined) {
      const depth = -(0.2 + 0.15 * Math.abs(next())) * step;
      line.push(point(0.4, 0), point(0.4, depth), point(0.6, depth), point(0.6, 0));
      addIsland(bay, [point(0.45, 0.85 * depth), point(0.55, 0.85 * depth), point(0.55, 0.15 * depth), point(0.45, 0.15 * depth)]);
      for (let m = 1; m <= count; m += 1) {
        const t = m / (count + 1);
        if (t > 0.65) line.push(point(t, 0.15 * step * Math.sin(Math.PI * t) * next()));
      }
    }
    line.push(to);
    return line;
  };
  const across: Position[][][] = [];
  const up: Position[][][] = [];
  for (let c = 0; c <= columns; c += 1) {
    across.push([]);
    up.push([]);
    for (let r = 0; r <= rows; r += 1) {
      // A bottom border of a tile, with a bay down into the tile or the frame below it. The tile 0,0 has an island at
      // its center, so the border above that tile has no bay.
      const bay = c < columns && r < rows && !(c === 0 && r === 1) && next() > 0.2 ? `${c},${r}` : undefined;
      if (c < columns) across[c]?.push(wiggle(at(c, r), at(c + 1, r), bay));
      if (r < rows) up[c]?.push(wiggle(at(c, r), at(c, r + 1)));
    }
  }
  const h = (c: number, r: number): Position[] => across[c]?.[r] as Position[];
  const v = (c: number, r: number): Position[] => up[c]?.[r] as Position[];
  const tile = (c: number, r: number): Position[] => join([h(c, r), v(c + 1, r), reversed(h(c, r + 1)), reversed(v(c, r))]);
  const center: Position = [(at(0, 0)[0] + at(1, 1)[0]) / 2, (at(0, 0)[1] + at(1, 1)[1]) / 2];
  const sides = 5 + Math.floor(Math.abs(next()) * 8);
  const island: Position[] = [];
  for (let m = 0; m < sides; m += 1) {
    const radius = 0.08 * step * (0.7 + 0.3 * Math.abs(next()));
    island.push([center[0] + radius * Math.cos((2 * Math.PI * m) / sides), center[1] + radius * Math.sin((2 * Math.PI * m) / sides)]);
  }
  addIsland("0,0", island);
  const regions: Region[] = [];
  const pair: Position[][][] = [];
  for (let c = 0; c < columns; c += 1) {
    for (let r = 0; r < rows; r += 1) {
      const rings = [tile(c, r), ...(holes.get(`${c},${r}`) ?? [])];
      const last = c === columns - 1 && r === rows - 1;
      if (columns > 1 && (last || (c === 0 && r === rows - 1))) pair.push(rings);
      else regions.push({ type: "Polygon", coordinates: rings });
    }
  }
  if (pair.length > 0) regions.push({ type: "MultiPolygon", coordinates: pair });
  for (const ring of islands) regions.push({ type: "Polygon", coordinates: [ring] });
  const outline = join([
    ...Array.from({ length: columns }, (_, c) => h(c, 0)),
    ...Array.from({ length: rows }, (_, r) => v(columns, r)),
    ...Array.from({ length: columns }, (_, c) => reversed(h(columns - 1 - c, rows))),
    ...Array.from({ length: rows }, (_, r) => reversed(v(0, rows - 1 - r))),
  ]);
  const [low, high] = [-1, columns * step + 1];
  const [bottom, top] = [-1, rows * step + 1];
  const square: Position[] = [
    [x0 + low, y0 + bottom],
    [x0 + high, y0 + bottom],
    [x0 + high, y0 + top],
    [x0 + low, y0 + top],
    [x0 + low, y0 + bottom],
  ];
  regions.push({ type: "Polygon", coordinates: [square, reversed(outline)] });
  return { regions, area: Math.abs(ringArea(square)) };
}

/** This function gives the problems of the result against its input and the tolerance. An empty list is a pass. */
function problems(input: readonly Region[], output: readonly Region[], toleranceKm: number): string[] {
  const found: string[] = [];
  if (output.length !== input.length) return [`${output.length} regions for ${input.length}`];
  input.forEach((region, index) => {
    const result = output[index] as Region;
    if (result.type !== region.type) found.push(`region ${index}: type ${result.type}`);
    const before = new Set(ringsOf(region).flat().map(keyOf));
    const rings = ringsOf(result);
    for (const ring of rings) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first === undefined || last === undefined || keyOf(first) !== keyOf(last)) found.push(`region ${index}: a ring is not closed`);
      if (new Set(ring.map(keyOf)).size < 3) found.push(`region ${index}: a ring has fewer than 3 positions`);
      for (const position of ring) if (!before.has(keyOf(position))) found.push(`region ${index}: a new position ${keyOf(position)}`);
    }
    const lines = { type: "MultiLineString", coordinates: rings } as const;
    for (const position of ringsOf(region).flat()) {
      const distance = distanceToGeometryKm({ lat: position[1], lon: position[0] }, lines);
      if (!(distance <= toleranceKm)) found.push(`region ${index}: ${keyOf(position)} is ${distance} km from the result`);
    }
  });
  // The regions of the input do not overlap. So no position of a region of the result is inside another region.
  output.forEach((region, index) => {
    const positions = new Map(ringsOf(region).flat().map((position) => [keyOf(position), position]));
    output.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      for (const [key, [lon, lat]] of positions) {
        if (locatePoint({ lat, lon }, other) === "inside") found.push(`region ${index}: ${key} is inside region ${otherIndex}`);
      }
    });
  });
  // The edges of the result: each pair meets only at a shared end, or not at all.
  const edges = new Map<string, readonly [Position, Position]>();
  for (const ring of output.flatMap(ringsOf)) {
    for (let t = 0; t + 1 < ring.length; t += 1) {
      const a = ring[t] as Position;
      const b = ring[t + 1] as Position;
      const key = [keyOf(a), keyOf(b)].sort().join(" ");
      edges.set(key, [a, b]);
    }
  }
  const list = [...edges.values()];
  for (let s = 0; s < list.length; s += 1) {
    for (let t = s + 1; t < list.length; t += 1) {
      const [a, b] = list[s] as readonly [Position, Position];
      const [c, d] = list[t] as readonly [Position, Position];
      const { relation } = classifySegments(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
      const shared = [a, b].some((p) => [c, d].some((q) => keyOf(p) === keyOf(q)));
      if (relation === "cross" || relation === "overlap" || (relation === "touch" && !shared)) {
        found.push(`the edges ${keyOf(a)} ${keyOf(b)} and ${keyOf(c)} ${keyOf(d)}: ${relation}`);
      }
    }
  }
  return found;
}

/**
 * A uniform value from `min` to `max` in steps of 1/1000 of the range. `fc.double` takes floats uniformly by their
 * bits, so most of its values are very near 0.
 */
const uniform = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min: 0, max: 1000 }).map((value) => min + ((max - min) * value) / 1000);

const noise = fc.array(uniform(-1, 1), { minLength: 64, maxLength: 256 });

describe("simplifyRegions", () => {
  it("keeps each position at the tolerance 0 when no position is on the edge of its neighbors", () => {
    const { regions } = tiling([0.3, -0.7, 0.9, -0.2, 0.55, -0.45, 0.1, 0.8, -0.95], 3, 2);
    expect(simplifyRegions(regions, 0)).toEqual(regions);
  });

  it("removes a position on the edge of its neighbors at the tolerance 0, and duplicate positions", () => {
    const square: Polygon = { type: "Polygon", coordinates: [[[0, 0], [0.5, 0], [1, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
    expect(simplifyRegions([square], 0)).toEqual([{ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }]);
  });

  it("removes the positions of a shared border in the two regions", () => {
    const border: Position[] = [[1, 0], [1.02, 0.25], [0.99, 0.5], [1.01, 0.75], [1, 1]];
    const west: Polygon = { type: "Polygon", coordinates: [[[0, 0], ...border, [0, 1], [0, 0]]] };
    const east: Polygon = { type: "Polygon", coordinates: [[[2, 0], [2, 1], ...reversed(border), [2, 0]]] };
    const [a, b] = simplifyRegions([west, east], 3) as [Polygon, Polygon];
    const shared = (polygon: Polygon): string[] => (polygon.coordinates[0] ?? []).filter(([x]) => x > 0.9 && x < 1.1).map(keyOf);
    expect(shared(a)).toEqual(["1,0", "1,1"]);
    expect(shared(b).sort()).toEqual(shared(a).sort());
    const [c, d] = simplifyRegions([west, east], 1) as [Polygon, Polygon];
    expect(shared(c).length).toBeGreaterThan(2);
    expect(shared(d).sort()).toEqual(shared(c).sort());
  });

  it("keeps a position of a border when an island is in the lobe of its removal", () => {
    // The border has a bay, and an island is in the bay. A straight border would put the island out of its region.
    const island: Position[] = [[0.45, -0.04], [0.55, -0.04], [0.55, -0.01], [0.45, -0.01], [0.45, -0.04]];
    const exterior: Position[] = [[0, 0], [0.4, 0], [0.4, -0.05], [0.6, -0.05], [0.6, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const regions: Region[] = [
      { type: "Polygon", coordinates: [exterior, reversed(island)] },
      { type: "Polygon", coordinates: [island] },
    ];
    const result = simplifyRegions(regions, 10);
    expect(problems(regions, result, 10)).toEqual([]);
    const [county, small] = result as [Polygon, Polygon];
    const outline: Polygon = { type: "Polygon", coordinates: [county.coordinates[0] ?? []] };
    for (const [lon, lat] of small.coordinates[0] ?? []) expect(locatePoint({ lat, lon }, outline)).toBe("inside");
    expect((county.coordinates[0] ?? []).map(keyOf)).toContain("0.4,-0.05");
  });

  it("keeps a position of a border when its removal puts a kept position on the border", () => {
    // A corner of the island is on the straight border. The lobe test sees it on the boundary, so the pair test finds it.
    const island: Position[] = [[0.5, 0], [0.6, 0.1], [0.4, 0.1], [0.5, 0]];
    const exterior: Position[] = [[0, 0], [0.5, -0.01], [1, 0], [1, 1], [0, 1], [0, 0]];
    const regions: Region[] = [
      { type: "Polygon", coordinates: [exterior, reversed(island)] },
      { type: "Polygon", coordinates: [island] },
    ];
    const result = simplifyRegions(regions, 10);
    expect(problems(regions, result, 10)).toEqual([]);
    expect(((result[0] as Polygon).coordinates[0] ?? []).map(keyOf)).toContain("0.5,-0.01");
  });

  it("keeps 3 positions of each ring at a very large tolerance", () => {
    const { regions, area } = tiling([0.4, -0.3, 0.8, -0.6, 0.2], 2, 2);
    const result = simplifyRegions(regions, 10_000);
    expect(problems(regions, result, 10_000)).toEqual([]);
    for (const ring of result.flatMap(ringsOf)) expect(ring.length).toBeGreaterThanOrEqual(4);
    expect(result.reduce((sum, region) => sum + regionArea(region), 0)).toBeCloseTo(area, 9);
  });

  it("keeps a ring with fewer than 3 different positions as it is", () => {
    const flat: Polygon = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [0, 0], [1, 0], [0, 0]]] };
    expect(simplifyRegions([flat], 5)).toEqual([flat]);
  });

  it("gives empty regions for empty regions, and a region of each type", () => {
    const empty: Polygon = { type: "Polygon", coordinates: [] };
    const none: MultiPolygon = { type: "MultiPolygon", coordinates: [] };
    expect(simplifyRegions([empty, none], 1)).toEqual([empty, none]);
    expect(simplifyRegions([], 1)).toEqual([]);
  });

  it("starts each ring at the first position of the input ring when it keeps that position", () => {
    const square: Polygon = { type: "Polygon", coordinates: [[[1, 1], [0, 1], [0, 0], [1, 0], [1, 1]]] };
    expect(simplifyRegions([square], 1)).toEqual([square]);
  });

  it("works across the antimeridian when the longitudes are in one range", () => {
    const { regions, area } = tiling([0.5, -0.9, 0.3, 0.7, -0.1, -0.6, 0.95], 3, 3, [179.85, 10]);
    for (const toleranceKm of [0, 0.5, 2, 8]) {
      const result = simplifyRegions(regions, toleranceKm);
      expect(problems(regions, result, toleranceKm)).toEqual([]);
      expect(result.reduce((sum, region) => sum + regionArea(region), 0)).toBeCloseTo(area, 9);
    }
  });

  it("gives the same result as the simplifier of the regions, and the same result two times", () => {
    const { regions } = tiling([0.2, -0.8, 0.6, -0.4, 0.9], 3, 2);
    const simplify = regionSimplifier(regions);
    for (const toleranceKm of [0.3, 1, 4]) {
      expect(simplify(toleranceKm)).toEqual(simplifyRegions(regions, toleranceKm));
      expect(simplify(toleranceKm)).toEqual(simplify(toleranceKm));
    }
  });

  it("measures the tolerance on the sphere of the radius", () => {
    const { regions } = tiling([0.7, -0.2, 0.4, -0.9, 0.1], 2, 2);
    // On a sphere of half the radius, each distance is half. So half the tolerance gives the same result.
    expect(simplifyRegions(regions, 1, 3185.5044)).toEqual(simplifyRegions(regions, 2));
  });

  it("refuses an incorrect input with a GeoError", () => {
    const square: Polygon = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const code = (run: () => unknown): string | undefined => {
      try {
        run();
      } catch (error) {
        return error instanceof GeoError ? `${error.code} ${error.path}` : "not a GeoError";
      }
      return undefined;
    };
    expect(code(() => simplifyRegions([square], -1))).toBe("tolerance ");
    expect(code(() => simplifyRegions([square], Number.NaN))).toBe("not-finite ");
    expect(code(() => simplifyRegions([square], Number.POSITIVE_INFINITY))).toBe("not-finite ");
    expect(code(() => simplifyRegions([square], 1, 0))).toBe("radius ");
    expect(code(() => regionSimplifier([square])(-0.5))).toBe("tolerance ");
    expect(code(() => simplifyRegions([{ type: "Point", coordinates: [0, 0] } as unknown as Region], 1))).toBe("geojson-type [0]");
    expect(code(() => simplifyRegions([square, { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1]]] }], 1))).toBe(
      "too-few-positions [1].coordinates[0]",
    );
    const far: MultiPolygon = { type: "MultiPolygon", coordinates: [[[[0, 0], [600, 0], [0, 1], [0, 0]]]] };
    expect(code(() => simplifyRegions([far], 1))).toBe("longitude-range [0].coordinates[0][0][1]");
    expect(code(() => simplifyRegions("regions" as unknown as Region[], 1))).toBe("geojson-member ");
  });

  it("keeps the error bound, the borders and the topology of generated maps", () => {
    fc.assert(
      fc.property(noise, fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 }), uniform(0, 6), (values, columns, rows, toleranceKm) => {
        const { regions, area } = tiling(values, columns, rows);
        const result = simplifyRegions(regions, toleranceKm);
        expect(problems(regions, result, toleranceKm)).toEqual([]);
        expect(result.reduce((sum, region) => sum + regionArea(region), 0)).toBeCloseTo(area, 9);
      }),
      { numRuns: 40 },
    );
  });

  it("puts each sample point in one region at most", () => {
    fc.assert(
      fc.property(noise, uniform(0.5, 6), (values, toleranceKm) => {
        const { regions } = tiling(values, 2, 2);
        const result = simplifyRegions(regions, toleranceKm);
        for (let sample = 0; sample < 60; sample += 1) {
          const point = { lon: -0.02 + 0.24 * ((sample * 0.618) % 1), lat: -0.02 + 0.24 * ((sample * 0.381) % 1) };
          const inside = result.filter((region) => locatePoint(point, region) === "inside").length;
          expect(inside).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 20 },
    );
  });
});
