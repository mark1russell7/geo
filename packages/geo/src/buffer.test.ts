import { describe, expect, it } from "vitest";
import {
  bufferKm,
  bufferMeters,
  DEFAULT_MAX_BUFFER_CELLS,
  destinationKm,
  distanceToGeometryKm,
  EARTH_MEAN_RADIUS_KM,
  followsRightHandRule,
  GeoError,
  locatePoint,
  parseGeometry,
  ringWinding,
  type Geometry,
  type LatLon,
  type MultiPolygon,
  type Polygon,
  type Position,
} from "./index.ts";

/** Half of the circumference of the sphere, in kilometres. */
const HALF = Math.PI * EARTH_MEAN_RADIUS_KM;

const at = (lat: number, lon: number): LatLon => ({ lat, lon });

/** This function gives the polygons of a result. */
function polygonsOf(shape: Polygon | MultiPolygon): readonly (readonly (readonly Position[])[])[] {
  return shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
}

/** This function gives each position of each ring of a result. */
function positionsOf(shape: Polygon | MultiPolygon): Position[] {
  return polygonsOf(shape).flatMap((rings) => rings.flatMap((ring) => [...ring]));
}

/** This function gives `true` when the point is in the result or on its boundary. */
const covers = (shape: Polygon | MultiPolygon, point: LatLon): boolean => locatePoint(point, shape) !== "outside";

/** This function gives the error code of a function that throws a `GeoError`. */
function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof GeoError) return error.code;
    throw error;
  }
  return "no error";
}

/**
 * This function examines the guarantee at the points at a distance of `distance - 1.01 tolerance` and of
 * `distance + 1.01 tolerance` from each center, in 72 directions. It gives the failures.
 */
function bandFailures(geometry: Geometry, shape: Polygon | MultiPolygon, centers: readonly LatLon[], distance: number, tolerance: number): string[] {
  const found: string[] = [];
  for (const center of centers) {
    for (let bearing = 0; bearing < 360; bearing += 5) {
      for (const reach of [distance - 1.01 * tolerance, distance + 1.01 * tolerance]) {
        const point = destinationKm(center, bearing, reach);
        const d = distanceToGeometryKm(point, geometry);
        if (Math.abs(d - distance) < tolerance) continue;
        if (covers(shape, point) !== d < distance) found.push(`${point.lat},${point.lon} at ${d} km`);
      }
    }
  }
  return found;
}

describe("bufferKm", () => {
  it("gives a circle for a point, inside the distance less the tolerance and outside the distance plus the tolerance", () => {
    const geometry: Geometry = { type: "Point", coordinates: [10, 50] };
    const shape = bufferKm(geometry, 25, { tolerance: 0.25 });
    expect(shape.type).toBe("Polygon");
    expect(followsRightHandRule(shape)).toBe(true);
    expect(bandFailures(geometry, shape, [at(50, 10)], 25, 0.25)).toEqual([]);
  });

  it("uses the distance over 100 as the default tolerance", () => {
    const geometry: Geometry = { type: "Point", coordinates: [-70, -30] };
    const shape = bufferKm(geometry, 40);
    expect(bandFailures(geometry, shape, [at(-30, -70)], 40, 0.4)).toEqual([]);
  });

  it("gives the band of a line around each of its positions and along its edges", () => {
    const line: Position[] = [[-97, 31], [-96, 31.5], [-95.5, 30.8]];
    const geometry: Geometry = { type: "LineString", coordinates: line };
    const shape = bufferKm(geometry, 10, { tolerance: 0.2 });
    const centers = [...line.map(([lon, lat]) => at(lat, lon)), at(31.25, -96.5), at(31.15, -95.75)];
    expect(bandFailures(geometry, shape, centers, 10, 0.2)).toEqual([]);
  });

  it("includes the polygon, and a band around it", () => {
    const ring: Position[] = [[0, 0], [2, 0], [2, 1], [1, 0.5], [0, 1], [0, 0]];
    const geometry: Geometry = { type: "Polygon", coordinates: [ring] };
    const shape = bufferKm(geometry, 20, { tolerance: 0.2 });
    for (const [lon, lat] of ring) expect(covers(shape, at(lat, lon))).toBe(true);
    expect(covers(shape, at(0.5, 0.5))).toBe(true);
    expect(bandFailures(geometry, shape, ring.map(([lon, lat]) => at(lat, lon)), 20, 0.2)).toEqual([]);
  });

  it("gives a hole in the buffer of a closed line, where the points are far from the line", () => {
    const geometry: Geometry = { type: "LineString", coordinates: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]] };
    const shape = bufferKm(geometry, 20, { tolerance: 0.2 });
    expect(shape.type).toBe("Polygon");
    const rings = (shape as Polygon).coordinates;
    expect(rings).toHaveLength(2);
    expect(ringWinding(rings[0] as Position[])).toBe("counterclockwise");
    expect(ringWinding(rings[1] as Position[])).toBe("clockwise");
    expect(covers(shape, at(0.5, 0.5))).toBe(false);
    expect(covers(shape, at(0.1, 0.5))).toBe(true);
  });

  it("gives one polygon for each group of points that are far apart", () => {
    const geometry: Geometry = { type: "MultiPoint", coordinates: [[0, 0], [0.3, 0], [5, 5]] };
    const shape = bufferKm(geometry, 20, { tolerance: 0.2 });
    expect(shape.type).toBe("MultiPolygon");
    expect(polygonsOf(shape)).toHaveLength(2);
  });

  it("gives a valid polygon for two circles with a narrow neck, where cells have four crossings", () => {
    // The circles overlap by 4 m. With this tolerance, a cell at the neck has four crossings and its center is inside,
    // and other cells have four crossings and an outside center. Thus the test examines each choice of marching squares.
    const a = at(0.003, 0.004);
    const b = destinationKm(a, 45, 2 - 0.004);
    const geometry: Geometry = { type: "MultiPoint", coordinates: [[a.lon, a.lat], [b.lon, b.lat]] };
    const shape = bufferKm(geometry, 1, { tolerance: 0.6 });
    expect(shape.type).toBe("Polygon");
    expect(parseGeometry(shape).tag).toBe("ok");
    expect(followsRightHandRule(shape)).toBe(true);
    expect(bandFailures(geometry, shape, [a, b], 1, 0.6)).toEqual([]);
  });

  it("cuts a buffer across the antimeridian at 180 and at -180", () => {
    const geometry: Geometry = { type: "Point", coordinates: [179.9, -16] };
    const shape = bufferKm(geometry, 50, { tolerance: 0.5 });
    expect(shape.type).toBe("MultiPolygon");
    expect(polygonsOf(shape)).toHaveLength(2);
    const longitudes = positionsOf(shape).map(([lon]) => lon);
    expect(longitudes).toContain(180);
    expect(longitudes).toContain(-180);
    expect(longitudes.every((lon) => lon >= -180 && lon <= 180)).toBe(true);
    expect(bandFailures(geometry, shape, [at(-16, 179.9)], 50, 0.5)).toEqual([]);
  });

  it("cuts the buffer of a line with longitudes past 180", () => {
    const geometry: Geometry = { type: "LineString", coordinates: [[170, -5], [195, 5]] };
    const shape = bufferKm(geometry, 100, { tolerance: 2 });
    expect(polygonsOf(shape)).toHaveLength(2);
    expect(covers(shape, at(4, -166))).toBe(true);
    expect(covers(shape, at(-4, 171))).toBe(true);
    expect(bandFailures(geometry, shape, [at(-5, 170), at(5, -165), at(0, 177.5)], 100, 2)).toEqual([]);
  });

  it("gives a buffer around a pole with an edge along the pole", () => {
    const geometry: Geometry = { type: "Point", coordinates: [30, 89.5] };
    const shape = bufferKm(geometry, 100, { tolerance: 1 });
    expect(shape.type).toBe("Polygon");
    expect(positionsOf(shape).some(([, lat]) => lat === 90)).toBe(true);
    expect(covers(shape, at(90, 0))).toBe(true);
    expect(followsRightHandRule(shape)).toBe(true);
    expect(bandFailures(geometry, shape, [at(89.5, 30)], 100, 1)).toEqual([]);
  });

  it("gives a result that parseGeometry accepts, with the right-hand rule", () => {
    const geometry: Geometry = {
      type: "GeometryCollection",
      geometries: [
        { type: "Point", coordinates: [179.5, 60] },
        { type: "LineString", coordinates: [[-20, 70], [-10, 80]] },
        { type: "Polygon", coordinates: [[[0, -60], [10, -60], [10, -55], [0, -60]]] },
      ],
    };
    const shape = bufferKm(geometry, 150, { tolerance: 3 });
    expect(parseGeometry(shape).tag).toBe("ok");
    expect(followsRightHandRule(shape)).toBe(true);
  });

  it("gives an empty MultiPolygon for a geometry with no position", () => {
    expect(bufferKm({ type: "GeometryCollection", geometries: [] }, 5)).toEqual({ type: "MultiPolygon", coordinates: [] });
    expect(bufferKm({ type: "MultiPolygon", coordinates: [] }, 5)).toEqual({ type: "MultiPolygon", coordinates: [] });
  });

  it("gives the whole Earth for a distance of half the circumference or more", () => {
    const world = bufferKm({ type: "Point", coordinates: [0, 0] }, HALF);
    expect(world).toEqual({ type: "Polygon", coordinates: [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]] });
    expect(bufferKm({ type: "Point", coordinates: [5, 5] }, 2 * HALF)).toEqual(world);
  });

  it("gives the same result for the same input", () => {
    const geometry: Geometry = { type: "LineString", coordinates: [[0, 0], [1, 1]] };
    expect(bufferKm(geometry, 30, { tolerance: 1 })).toEqual(bufferKm(geometry, 30, { tolerance: 1 }));
  });

  it("refuses an incorrect distance, tolerance or limit", () => {
    const point: Geometry = { type: "Point", coordinates: [0, 0] };
    expect(codeOf(() => bufferKm(point, 0))).toBe("radius");
    expect(codeOf(() => bufferKm(point, -1))).toBe("radius");
    expect(codeOf(() => bufferKm(point, Number.NaN))).toBe("not-finite");
    expect(codeOf(() => bufferKm(point, 10, { tolerance: 0 }))).toBe("tolerance");
    expect(codeOf(() => bufferKm(point, 10, { tolerance: -1 }))).toBe("tolerance");
    expect(codeOf(() => bufferKm(point, 10, { tolerance: 10 }))).toBe("tolerance");
    expect(codeOf(() => bufferKm(point, 10, { tolerance: Number.POSITIVE_INFINITY }))).toBe("not-finite");
    expect(codeOf(() => bufferKm(point, 10, { maxCells: 0 }))).toBe("max-cells");
    expect(codeOf(() => bufferKm(point, 10, { maxCells: Number.NaN }))).toBe("max-cells");
    expect(codeOf(() => bufferKm(point, 10, {}, 0))).toBe("radius");
    expect(codeOf(() => bufferKm({ type: "Point", coordinates: [0, 91] }, 10))).toBe("latitude-range");
  });

  it("refuses a buffer that needs more cells than the limit", () => {
    expect(DEFAULT_MAX_BUFFER_CELLS).toBe(1_000_000);
    expect(codeOf(() => bufferKm({ type: "Point", coordinates: [0, 0] }, 10, { maxCells: 10 }))).toBe("too-many-cells");
    // The grid of this buffer has more than 2^50 corners, so the function refuses it before it makes a cell.
    expect(codeOf(() => bufferKm({ type: "Point", coordinates: [0, 0] }, 1000, { tolerance: 1e-9 }))).toBe("too-many-cells");
  });
});

describe("bufferMeters", () => {
  it("gives the buffer of bufferKm with the distances in metres", () => {
    const geometry: Geometry = { type: "Point", coordinates: [2.35, 48.85] };
    const shape = bufferMeters(geometry, 2_000, { tolerance: 20 });
    expect(followsRightHandRule(shape)).toBe(true);
    expect(bandFailures(geometry, shape, [at(48.85, 2.35)], 2, 0.02)).toEqual([]);
  });
});
