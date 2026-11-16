/**
 * This module tells the three suites of the bench as data: the base of each suite, its cases and the claims of its
 * report.
 *
 * - The suite `simplify` (roadmap item R14) times `simplifyRegions` on the maps of `map.ts`. Its speed gate holds a
 *   budget and a growth.
 * - The suite `locate` (roadmap item R10) times the location of each place of a case of `shapes.ts`. The head uses
 *   `pointLocator`, and the base uses `locatePoint`. Its speed gate holds a budget and a growth.
 * - The suite `buffer` (roadmap item R16) times `bufferKm` on the cases of `buffers.ts`. At this time, its report only
 *   reads the claims.
 *
 * In each suite, a case with a different result in `head` and `base`, or with no result, fails the run.
 *
 * @packageDocumentation
 */

import { BUFFER_CASES } from "./buffers.ts";
import { CASES } from "./map.ts";
import { LOCATE_CASES } from "./shapes.ts";

/** The id of a suite. */
export type SuiteId = "simplify" | "locate" | "buffer";

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

/** The arm `base` of a suite: a version of `@mark1russell7/geo` from npm, by its alias in `package.json`. */
export interface SuiteBase {
  readonly module: "geo-base" | "geo-buffer-base";
  readonly version: string;
}

/** A suite of the bench. */
export interface Suite {
  readonly id: SuiteId;
  /** The title of the report. */
  readonly title: string;
  readonly base: SuiteBase;
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
  base: { module: "geo-base", version: "0.3.1" },
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
 * The suite of R10. The limits are the worst high ends of 5 CI runs plus their spread. The runs are 43830188869,
 * 43843439775, 43849286887, 43862267058 and 43877513514, on the same code of `pointLocator`:
 *
 * - The budget: 58.7 ms plus 26.8 ms gives 86 ms. `locatePoint` of geo 0.3.1 takes 30 s to 60 s on this case.
 * - The difference of the two arms of `head`: 1.55 ms plus 1.07 ms, rounded up to 3 ms.
 * - The growth for each 10 times more vertices of the coasts with 10,000 places: 2.38 plus 0.71 gives 3.1. A cost that
 *   grows as the vertices gives 10.
 */
export const LOCATE: Suite = {
  id: "locate",
  title: "The bench of pointLocator (R10)",
  base: { module: "geo-base", version: "0.3.1" },
  cases: LOCATE_CASES.map((spec) => spec.id),
  budget: { case: "coast-1e5-1e4", limitMs: 86, maxDifferenceMs: 3 },
  growth: {
    sizeOf: (id) => {
      const spec = LOCATE_CASES.find((entry) => entry.id === id);
      return spec !== undefined && spec.shape === "coast" && spec.places === 10_000 ? spec.vertices : undefined;
    },
    maxGrowth: 3.1,
    describe: "the vertices of the coasts with 10,000 places",
  },
  enforced: true,
  profileCase: "coast-1e5-1e4",
};

/**
 * The suite of R16. Its base is geo 0.4.4, the last version before the faster buffer. It has no budget at this time:
 * the limits of its gate come from 5 CI runs, as in the other suites. The growth reads the 3 tolerances of one coast.
 * A cost in proportion to the count of the cells gives 10.
 */
export const BUFFER: Suite = {
  id: "buffer",
  title: "The bench of bufferKm (R16)",
  base: { module: "geo-buffer-base", version: "0.4.4" },
  cases: BUFFER_CASES.map((spec) => spec.id),
  growth: {
    sizeOf: (id) => {
      const spec = BUFFER_CASES.find((entry) => entry.id === id);
      return spec !== undefined && spec.shape === "coast" && spec.vertices === 1_000 ? 1 / spec.toleranceKm : undefined;
    },
    maxGrowth: 10,
    describe: "one coast over 3 tolerances, as the length of the boundary over the tolerance",
  },
  enforced: false,
  profileCase: "coast-1e3-t0.3",
};

/** The suites, by id. */
export const SUITES: Readonly<Record<SuiteId, Suite>> = { simplify: SIMPLIFY, locate: LOCATE, buffer: BUFFER };

/** This function gives the suite with the id, or a `RangeError`. */
export function suiteOf(id: string): Suite {
  if (id === "simplify" || id === "locate" || id === "buffer") return SUITES[id];
  throw new RangeError(`There is no suite ${id}. The suites: ${Object.keys(SUITES).join(", ")}`);
}
