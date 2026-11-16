import { locatePoint, type Polygon, type Position, ringWinding } from "@mark1russell7/geo";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import { locatePoint as locateBase } from "geo-base";
import { describe, expect, it } from "vitest";
import { LOCATE_CASES, locateCaseOf, type LocateSpec, placesOf, polygonOf, positionsOf } from "./index.ts";

/** Small cases of each shape, for the tests. The cases of the bench are too large for a quick test. */
const small: Record<string, LocateSpec> = {
  coast: { id: "test-coast", shape: "coast", vertices: 2_000, places: 2_000 },
  star: { id: "test-star", shape: "star", vertices: 2_000, places: 2_000 },
  parts: { id: "test-parts", shape: "parts", vertices: 20_000, places: 1_000 },
};

const ringsOf = (polygon: ReturnType<typeof polygonOf>): (readonly Position[])[] =>
  polygon.type === "Polygon" ? [...polygon.coordinates] : polygon.coordinates.flat();

describe("the locate cases", () => {
  it("have unique ids, and the product of the vertices and the places is at most 1e9", () => {
    expect(new Set(LOCATE_CASES.map((spec) => spec.id)).size).toBe(LOCATE_CASES.length);
    for (const spec of LOCATE_CASES) expect(spec.vertices * spec.places).toBeLessThanOrEqual(1e9);
    expect(locateCaseOf("coast-1e5-1e4")).toMatchObject({ shape: "coast", vertices: 100_000, places: 10_000 });
    expect(() => locateCaseOf("no-case")).toThrow(RangeError);
  });

  it.each(Object.keys(small))("make the same %s for the same case", (shape) => {
    const spec = small[shape] as LocateSpec;
    const polygon = polygonOf(spec);
    expect(canonicalHash(polygon)).toBe(canonicalHash(polygonOf(spec)));
    expect(canonicalHash(placesOf(spec, polygon))).toBe(canonicalHash(placesOf(spec, polygonOf(spec))));
  });

  it.each(Object.keys(small))("make a %s with the target count of positions within 2 %%, in closed counterclockwise rings", (shape) => {
    const spec = small[shape] as LocateSpec;
    const polygon = polygonOf(spec);
    expect(Math.abs(positionsOf(polygon).length - spec.vertices) / spec.vertices).toBeLessThan(0.02);
    for (const ring of ringsOf(polygon)) {
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ringWinding(ring)).toBe("counterclockwise");
    }
  });

  it("make one Polygon for a coast and a star, and a MultiPolygon of 552 parts", () => {
    expect(polygonOf(small["coast"] as LocateSpec).type).toBe("Polygon");
    expect(polygonOf(small["star"] as LocateSpec).type).toBe("Polygon");
    const parts = polygonOf(small["parts"] as LocateSpec);
    expect(parts.type).toBe("MultiPolygon");
    expect(parts.coordinates).toHaveLength(552);
  });

  it("make a star with angles that grow, so no edge crosses another edge", () => {
    const ring = (polygonOf(small["star"] as LocateSpec) as Polygon).coordinates[0] as readonly Position[];
    const angles = ring.slice(0, -1).map(([x, y]) => Math.atan2(y - 31.25, x + 99));
    const turns = angles.map((angle) => (angle < 0 ? angle + 2 * Math.PI : angle));
    for (let index = 1; index < turns.length; index += 1) expect(turns[index]).toBeGreaterThan(turns[index - 1] as number);
  });

  it.each(Object.keys(small))("give the places of a %s: values with 6 decimals in the box with its margin, and 2 %% at vertices", (shape) => {
    const spec = small[shape] as LocateSpec;
    const polygon = polygonOf(spec);
    const places = placesOf(spec, polygon);
    expect(places).toHaveLength(spec.places);
    const positions = positionsOf(polygon);
    const vertices = new Set(positions.map(([x, y]) => `${x},${y}`));
    const xs = positions.map((position) => position[0]);
    const ys = positions.map((position) => position[1]);
    const [west, east, south, north] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const { lat, lon } of places) {
      expect(Math.round(lat * 1e6) / 1e6).toBe(lat);
      expect(Math.round(lon * 1e6) / 1e6).toBe(lon);
      expect(lon).toBeGreaterThanOrEqual(west - (east - west) * 0.05 - 1e-6);
      expect(lon).toBeLessThanOrEqual(east + (east - west) * 0.05 + 1e-6);
      expect(lat).toBeGreaterThanOrEqual(south - (north - south) * 0.05 - 1e-6);
      expect(lat).toBeLessThanOrEqual(north + (north - south) * 0.05 + 1e-6);
    }
    const atVertex = places.filter(({ lat, lon }) => vertices.has(`${lon},${lat}`)).length / places.length;
    expect(atVertex).toBeGreaterThan(0.01);
    expect(atVertex).toBeLessThan(0.04);
  });

  it.each(Object.keys(small))("give the same locations with geo 0.3.1 and with the head of geo on a %s, with each kind of location", (shape) => {
    const spec = small[shape] as LocateSpec;
    const polygon = polygonOf(spec);
    const places = placesOf(spec, polygon);
    const head = places.map((place) => locatePoint(place, polygon));
    expect(canonicalHash(head)).toBe(canonicalHash(places.map((place) => locateBase(place, polygon))));
    expect(new Set(head)).toEqual(new Set(["inside", "boundary", "outside"]));
    // The case parts examines 20,000 vertices for each of 1,000 places, two times. With coverage, CI took 6.6 s.
  }, 30_000);
});
