import { dyadic } from "@mark1russell7/predicates";
import fc from "fast-check";
import { uniformDouble } from "@mark1russell7/rigor-testkit/arbitrary";
import { describe, expect, it } from "vitest";
import { overlappingShifts, shiftsInto } from "./planar.ts";

describe("the shifts", () => {
  it("test the range with no rounding", () => {
    // The floating-point sum L + 360 rounds to 232, but the exact sum is more than 232.
    const value = -128 + 2 ** -46;
    expect(value + 360).toBe(232);
    expect(shiftsInto(value, 0, 232)).toEqual([]);
    expect(shiftsInto(value, 0, 232 + 2 ** -45)).toEqual([360]);
    expect(overlappingShifts(0, 232, value, value)).toEqual([]);
    // Here the floating-point sum rounds up to the bound, but the exact sum is less than the bound.
    const low = -128 + 3 * 2 ** -46;
    expect(low + 360).toBe(232 + 2 ** -44);
    expect(overlappingShifts(232 + 2 ** -44, 300, -200, low)).toEqual([]);
    expect(overlappingShifts(232 + 2 ** -45, 300, -200, low)).toEqual([360]);
  });

  it("are the negatives of the shifts in the other order", () => {
    const range = fc
      .tuple(uniformDouble({ min: -540, max: 540 }), uniformDouble({ min: -540, max: 540 }))
      .map(([p, q]): readonly [number, number] => (p <= q ? [p, q] : [q, p]));
    fc.assert(
      fc.property(range, range, ([minA, maxA], [minB, maxB]) => {
        const forward = overlappingShifts(minA, maxA, minB, maxB).map((s) => 0 - s);
        expect([...overlappingShifts(minB, maxB, minA, maxA)].sort((p, q) => p - q)).toEqual(forward.sort((p, q) => p - q));
      }),
    );
  });

  it("include each shift that moves the value into the range, and no other shift", () => {
    const value = uniformDouble({ min: -180, max: 180 });
    const min = uniformDouble({ min: -540, max: 540 });
    const width = fc.oneof(fc.constant(0), uniformDouble({ min: 0, max: 400 }));
    fc.assert(
      fc.property(value, min, width, (x, low, size) => {
        const high = low + size;
        const shifts = shiftsInto(x, low, high);
        for (let k = -4; k <= 4; k += 1) {
          const sum = dyadic.add(dyadic.fromFloat(x), dyadic.fromFloat(360 * k));
          const inside = dyadic.compare(sum, dyadic.fromFloat(low)) >= 0 && dyadic.compare(sum, dyadic.fromFloat(high)) <= 0;
          expect(shifts.includes(360 * k)).toBe(inside);
        }
      }),
    );
  });
});
