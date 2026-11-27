import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("the seed of the property tests", () => {
  // The probe of the class: a property test with a new seed in each run changes the coverage of one tree (geo PR 69).
  it("is one fixed integer in each test file", () => {
    const { seed } = fc.readConfigureGlobal();
    expect(Number.isInteger(seed)).toBe(true);
  });
});
