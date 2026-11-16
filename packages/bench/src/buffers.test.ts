import { bufferKm, distanceToGeometryKm, type Geometry } from "@mark1russell7/geo";
import { describe, expect, it } from "vitest";
import { BUFFER_CASES, type BufferSpec, bufferCaseOf, bufferGeometryOf, classesOf, expectedClasses, samplesOf } from "./buffers.ts";

/** A small case for the tests: 6 points with circles of 10 km and a large tolerance, so the buffer is fast. */
const SMALL: BufferSpec = { id: "test-points-6", shape: "points", vertices: 6, distanceKm: 10, toleranceKm: 2, samples: 400 };

/** This function gives the count of the positions of a geometry of a case. */
function positionsOf(geometry: Geometry): number {
  if (geometry.type === "LineString" || geometry.type === "MultiPoint") return geometry.coordinates.length;
  if (geometry.type === "Polygon") return geometry.coordinates.flat().length;
  throw new RangeError(geometry.type);
}

describe("the cases of the suite buffer", () => {
  it("gives each case by its id, and refuses an id that does not exist", () => {
    expect(new Set(BUFFER_CASES.map((spec) => spec.id)).size).toBe(BUFFER_CASES.length);
    for (const spec of BUFFER_CASES) expect(bufferCaseOf(spec.id)).toBe(spec);
    expect(() => bufferCaseOf("no-case")).toThrow(RangeError);
  });

  it("gives the same geometry and the same samples for the same case", () => {
    for (const id of ["line-2e3-t1", "points-100-t1"]) {
      const spec = bufferCaseOf(id);
      const geometry = bufferGeometryOf(spec);
      expect(bufferGeometryOf(spec)).toEqual(geometry);
      expect(positionsOf(geometry)).toBe(spec.vertices);
      const samples = samplesOf(spec, geometry);
      expect(samples).toHaveLength(spec.samples);
      expect(samplesOf(spec, geometry)).toEqual(samples);
    }
  });

  it("puts half of the samples near the boundary of the buffer", () => {
    const spec = bufferCaseOf("line-2e3-t1");
    const geometry = bufferGeometryOf(spec);
    const near = samplesOf(spec, geometry).filter((_, index) => index % 2 === 1);
    for (const sample of near) {
      const km = distanceToGeometryKm(sample, geometry);
      expect(km).toBeLessThanOrEqual(spec.distanceKm + 2 * spec.toleranceKm + 1e-6);
    }
  });
});

describe("the digest of a buffer", () => {
  const geometry = bufferGeometryOf(SMALL);
  const samples = samplesOf(SMALL, geometry);
  const expected = expectedClasses(SMALL, geometry, samples);

  it("gives no fault for the buffer of the head, and skips each sample in the band", () => {
    const classes = classesOf(bufferKm(geometry, SMALL.distanceKm, { tolerance: SMALL.toleranceKm }), expected, samples);
    expect(classes.faults).toBe(0);
    expect(classes.samples).toBe(SMALL.samples);
    expect(classes.band).toBe(expected.filter((want) => want === undefined).length);
    expect(classes.band).toBeGreaterThan(0);
    expect(classes.classes).toHaveLength(SMALL.samples - classes.band);
    expect(classes.classes).toMatch(/1/);
    expect(classes.classes).toMatch(/0/);
  });

  it("gives faults for a buffer that is too small", () => {
    const small = bufferKm(geometry, SMALL.distanceKm / 2, { tolerance: SMALL.toleranceKm / 2 });
    expect(classesOf(small, expected, samples).faults).toBeGreaterThan(0);
  });
});
