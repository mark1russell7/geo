/**
 * This module tells the two suites of the bench as data: the cases of each suite and the claims of its report.
 *
 * - The suite `simplify` (roadmap item R14) times `simplifyRegions` on the maps of `map.ts`. Its speed gate holds a
 *   budget and a growth.
 * - The suite `locate` (roadmap item R10) times the location of each place of a case of `shapes.ts`. The head uses
 *   `pointLocator`, and the base uses `locatePoint`. At this time its report only reads the claims, and its budget is a
 *   temporary value. The limits of its gate come from 5 benches of the index of R10 in CI.
 *
 * In each suite, a case with a different result in `head` and `base`, or with no result, fails the run.
 *
 * @packageDocumentation
 */

import { CASES } from "./map.ts";
import { LOCATE_CASES } from "./shapes.ts";

/** The id of a suite. */
export type SuiteId = "simplify" | "locate";

/** A claim of a budget: the median of the arm `head` on one case is at most the limit. */
export interface BudgetClaim {
  readonly case: string;
  /** The limit on the high end of the interval of the median of `head`, in milliseconds. */
  readonly limitMs: number;
  /** The largest difference of the medians of `head` and `head-copy`, in milliseconds. A larger one is too noisy. */
  readonly maxDifferenceMs: number;
}

/** A claim on the growth of the time of `head` for each 10 times more of a size. */
export interface GrowthClaim {
  /** The size of a case, or `undefined` for a case out of the claim. */
  readonly sizeOf: (id: string) => number | undefined;
  readonly maxGrowth: number;
  /** The sentence that tells the cases of the claim. */
  readonly describe: string;
}

/** A suite of the bench. */
export interface Suite {
  readonly id: SuiteId;
  /** The title of the report. */
  readonly title: string;
  readonly cases: readonly string[];
  readonly budget?: BudgetClaim;
  readonly growth: GrowthClaim;
  /** `true` when a speed claim that is not `within` fails the run. With `false`, the report only reads the claims. */
  readonly enforced: boolean;
  /** The case of the CPU profile of `head`. */
  readonly profileCase: string;
}

/**
 * The suite of R14. The limits are the worst high ends of 5 CI runs plus their spread, from run 43779851312:
 *
 * - The budget: 287.5 ms plus 71.8 ms gives 360 ms. The target of the alerts project for one state is 500 ms.
 * - The difference of the two arms of `head`: 6.7 ms plus 4.9 ms, rounded up to 12 ms.
 * - The growth: 10.19 plus 1.81 gives 12. A cost that grows as n log n gives approximately 12.
 */
export const SIMPLIFY: Suite = {
  id: "simplify",
  title: "The bench of simplifyRegions (R14)",
  cases: CASES.map((spec) => spec.id),
  budget: { case: "tx-552-325k", limitMs: 360, maxDifferenceMs: 12 },
  growth: {
    sizeOf: (id) => {
      const spec = CASES.find((entry) => entry.id === id);
      return spec !== undefined && spec.columns * spec.rows === 552 ? spec.positions : undefined;
    },
    maxGrowth: 12,
    describe: "the positions of the 552 regions",
  },
  enforced: true,
  profileCase: "tx-552-325k",
};

/**
 * The suite of R10. The growth reads the coasts with 10,000 places for each 10 times more vertices. The value 12 is the
 * growth of a cost as n log n. At this time the budget is a temporary value, and the suite is not enforced. The limits
 * of its gate come from 5 CI benches of this budget.
 */
export const LOCATE: Suite = {
  id: "locate",
  title: "The bench of pointLocator (R10)",
  cases: LOCATE_CASES.map((spec) => spec.id),
  budget: { case: "coast-1e5-1e4", limitMs: 10_000, maxDifferenceMs: 1_000 },
  growth: {
    sizeOf: (id) => {
      const spec = LOCATE_CASES.find((entry) => entry.id === id);
      return spec !== undefined && spec.shape === "coast" && spec.places === 10_000 ? spec.vertices : undefined;
    },
    maxGrowth: 12,
    describe: "the vertices of the coasts with 10,000 places",
  },
  enforced: false,
  profileCase: "coast-1e5-1e4",
};

/** The suites, by id. */
export const SUITES: Readonly<Record<SuiteId, Suite>> = { simplify: SIMPLIFY, locate: LOCATE };

/** This function gives the suite with the id, or a `RangeError`. */
export function suiteOf(id: string): Suite {
  if (id === "simplify" || id === "locate") return SUITES[id];
  throw new RangeError(`There is no suite ${id}. The suites: ${Object.keys(SUITES).join(", ")}`);
}
