import { describe, expect, it } from "vitest";
import { US_STATES, usState } from "./index.ts";

describe("the states of the United States", () => {
  it("has 50 states, the district and 6 territories, in the order of the FIPS codes", () => {
    expect(US_STATES.filter((state) => state.kind === "state")).toHaveLength(50);
    expect(US_STATES.filter((state) => state.kind === "district")).toHaveLength(1);
    expect(US_STATES.filter((state) => state.kind === "territory")).toHaveLength(6);
    const codes = US_STATES.map((state) => state.fips);
    expect(codes).toEqual([...codes].sort());
  });

  it("has unique codes of the right form", () => {
    expect(new Set(US_STATES.map((state) => state.fips)).size).toBe(US_STATES.length);
    expect(new Set(US_STATES.map((state) => state.usps)).size).toBe(US_STATES.length);
    for (const state of US_STATES) {
      expect(state.fips).toMatch(/^\d{2}$/);
      expect(state.usps).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("finds a record by either code", () => {
    expect(usState("06")?.name).toBe("California");
    expect(usState("CA")).toBe(usState("06"));
    expect(usState("ca")?.fips).toBe("06");
    expect(usState("72")?.kind).toBe("territory");
    expect(usState("6")).toBeUndefined();
    expect(usState("03")).toBeUndefined();
    expect(usState("")).toBeUndefined();
  });

  it("does not change", () => {
    expect(Object.isFrozen(US_STATES)).toBe(true);
    expect(Object.isFrozen(US_STATES[0])).toBe(true);
  });
});
