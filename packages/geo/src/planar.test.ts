import { dyadic } from "@mark1russell7/predicates";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { movesExactly, overlappingShifts, shiftsInto } from "./planar.ts";

/** It gives `true` when the floating-point sum `x + shift` is equal to the exact sum. */
const exactSum = (x: number, shift: number): boolean =>
  dyadic.compare(dyadic.add(dyadic.fromFloat(x), dyadic.fromFloat(shift)), dyadic.fromFloat(x + shift)) === 0;

const shift = fc.integer({ min: -4, max: 4 }).map((k) => 360 * k);

describe("movesExactly", () => {
  it("holds only for a sum with no rounding", () => {
    fc.assert(fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), shift, (x, s) => !movesExactly(x, s) || exactSum(x, s)));
    fc.assert(fc.property(fc.double({ min: -2000, max: 2000, noNaN: true }), shift, (x, s) => !movesExactly(x, s) || exactSum(x, s)));
  });

  it("holds for each longitude from 128 to 540 moved by 360 against its sign", () => {
    fc.assert(fc.property(fc.double({ min: 128, max: 540, noNaN: true }), (x) => movesExactly(x, -360) && movesExactly(0 - x, 360)));
  });

  it("follows the rule at its limits", () => {
    expect(movesExactly(5, 0)).toBe(true);
    expect(movesExactly(128, -360)).toBe(true);
    expect(movesExactly(127.99999999999999, -360)).toBe(false);
    expect(movesExactly(200, 360)).toBe(false);
    expect(movesExactly(0, 360)).toBe(false);
    expect(movesExactly(256, -720)).toBe(true);
    expect(movesExactly(255.99999999999997, -720)).toBe(false);
    expect(movesExactly(2 ** 56, -360)).toBe(false);
    expect(movesExactly(Number.NaN, 360)).toBe(false);
    expect(movesExactly(Number.NEGATIVE_INFINITY, 360)).toBe(false);
  });
});

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
      .tuple(fc.double({ min: -540, max: 540, noNaN: true }), fc.double({ min: -540, max: 540, noNaN: true }))
      .map(([p, q]): readonly [number, number] => (p <= q ? [p, q] : [q, p]));
    fc.assert(
      fc.property(range, range, ([minA, maxA], [minB, maxB]) => {
        const forward = overlappingShifts(minA, maxA, minB, maxB).map((s) => 0 - s);
        expect([...overlappingShifts(minB, maxB, minA, maxA)].sort((p, q) => p - q)).toEqual(forward.sort((p, q) => p - q));
      }),
    );
  });

  it("include each shift that moves the value into the range, and no other shift", () => {
    const value = fc.double({ min: -180, max: 180, noNaN: true });
    const min = fc.double({ min: -540, max: 540, noNaN: true });
    const width = fc.oneof(fc.constant(0), fc.double({ min: 0, max: 400, noNaN: true }));
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
