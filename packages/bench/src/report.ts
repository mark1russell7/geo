/**
 * This module makes the report of a run of the bench from its records. The functions have no input or output, so the
 * tests hold them.
 *
 * - The time verdict compares the pair (base, head) with the A/A pair (base, base) over all cases.
 * - The budget verdict holds the median of the arm `head` on the case `tx-552-325k` to 360 ms, under the target of
 *   500 ms. Its A/A arm is the arm `head-copy`: the same code in other processes.
 * - The growth verdict reads the growth of the time of `head` for each 10 times more positions on the 552 regions.
 *   Each round is one job, so a slow round changes each size of that round.
 * - The hashes show if `base` and `head` give the same result on each case.
 * - The speed gate holds the budget and the growth of `head`. A verdict that cannot decide does not pass the gate.
 *
 * @packageDocumentation
 */

import {
  type BudgetRound,
  budgetVerdict,
  type BudgetVerdict,
  growthVerdict,
  type GrowthVerdict,
  type PairedTime,
  timeVerdict,
  type TimeVerdict,
} from "@mark1russell7/rigor-bench";
import { median } from "@mark1russell7/rigor-statistics";
import { CASES } from "./map.ts";

/** The case of the budget. */
export const BUDGET_CASE = "tx-552-325k";
/** The target of the alerts project for one state, in milliseconds. The limit of the gate is lower. */
export const TARGET_MS = 500;
/**
 * The limit of the gate on the high end of the interval of `head`, in milliseconds. It is the worst high end of 5 CI runs
 * (287.5) plus their spread (71.8), from run 43779851312.
 */
export const BUDGET_MS = 360;
/**
 * The largest difference of the medians of the two arms of `head`, in milliseconds. A larger difference makes the case
 * too noisy. It is the worst difference of the 5 CI runs (6.7) plus their spread (4.9), rounded up.
 */
export const BUDGET_DIFFERENCE_MS = 12;
/**
 * The largest growth of the time for each 10 times more positions, on the high end of the interval of each step. It is
 * the worst high end of the 5 CI runs (10.19) plus their spread (1.81). A cost that grows as n log n gives approximately 12.
 */
export const MAX_GROWTH = 12;

/** The records of a run, by the id of the pair: `head`, `head-copy` and `base~aa`. */
export type Pairs = Readonly<Record<string, readonly PairedTime[]>>;

/** One line of the hash file of a run. */
export interface HashLine {
  readonly arm: string;
  readonly case: string;
  readonly hash: string;
}

/** The row of one case. */
export interface CaseRow {
  readonly case: string;
  readonly rounds: number;
  /** The median time of `base` in the pair (base, head), in milliseconds. */
  readonly baseMs: number;
  readonly headMs: number;
  /** The median of the ratios head / base over the rounds. */
  readonly ratio: number;
  /** `true` when each hash of `base` and `head` on the case is the same, `false` when they differ, and `undefined` with no hash. */
  readonly sameResult: boolean | undefined;
}

/** A read of a claim: the outcome of its verdict, or `no read` when the run has too few cases for the verdict. */
export interface Read {
  readonly outcome: TimeVerdict["outcome"] | BudgetVerdict["outcome"] | GrowthVerdict["outcome"] | "no read";
  readonly reason: string;
}

export interface Report {
  readonly cases: readonly CaseRow[];
  readonly time: Read;
  readonly budget: Read & { readonly cases: BudgetVerdict["cases"] };
  readonly growth: Read & { readonly steps: GrowthVerdict["steps"] };
}

const sizeOf = (id: string): number | undefined => {
  const spec = CASES.find((entry) => entry.id === id);
  return spec !== undefined && spec.columns * spec.rows === 552 ? spec.positions : undefined;
};

/**
 * This function gives the faults of the speed gate of a run, or an empty list. The gate holds the budget when the run
 * has its case, and the growth when the run has 2 or more sizes. Each outcome other than `within` is a fault. Thus a
 * noisy run does not pass the gate.
 */
export function speedFaults(result: Pick<Report, "budget" | "growth">, ids: readonly string[]): string[] {
  const faults: string[] = [];
  if (ids.includes(BUDGET_CASE) && result.budget.outcome !== "within") {
    faults.push(`The budget of ${BUDGET_CASE} is "${result.budget.outcome}". ${result.budget.reason}`);
  }
  if (ids.filter((id) => sizeOf(id) !== undefined).length >= 2 && result.growth.outcome !== "within") {
    faults.push(`The growth is "${result.growth.outcome}". ${result.growth.reason}`);
  }
  return faults;
}

/** This function gives `true`, `false` or `undefined` for the hashes of `base` and `head` on one case. */
function sameResult(hashes: readonly HashLine[], id: string): boolean | undefined {
  const of = (arm: string): Set<string> => new Set(hashes.filter((line) => line.case === id && line.arm === arm).map((line) => line.hash));
  const base = of("base");
  const head = of("head");
  if (base.size === 0 || head.size === 0) return undefined;
  return base.size === 1 && head.size === 1 && [...base][0] === [...head][0];
}

/** This function makes the report of a run. */
export function report(pairs: Pairs, hashes: readonly HashLine[]): Report {
  const head = pairs["head"] ?? [];
  const copy = pairs["head-copy"] ?? [];
  const aa = pairs["base~aa"] ?? [];
  const ids = [...new Set(head.map((record) => record.case))];
  const cases = ids.map((id): CaseRow => {
    const rows = head.filter((record) => record.case === id);
    return {
      case: id,
      rounds: rows.length,
      baseMs: median(rows.map((record) => record.a)),
      headMs: median(rows.map((record) => record.b)),
      ratio: median(rows.map((record) => record.b / record.a)),
      sameResult: sameResult(hashes, id),
    };
  });
  const aaCases = new Set(aa.map((record) => record.case)).size;
  const time: Read =
    ids.length >= 5 && aaCases >= 5
      ? timeVerdict(head, aa)
      : { outcome: "no read", reason: `The A/A band needs 5 cases or more, and the run has ${Math.min(ids.length, aaCases)}.` };
  const budgetRounds = (records: readonly PairedTime[]): BudgetRound[] =>
    records.filter((record) => record.case === BUDGET_CASE).map((record) => ({ case: record.case, round: record.round, value: record.b }));
  const headBudget = budgetRounds(head);
  const copyBudget = budgetRounds(copy);
  const budget =
    headBudget.length > 0 && copyBudget.length > 0
      ? budgetVerdict(headBudget, copyBudget, { limit: BUDGET_MS, maxDifference: BUDGET_DIFFERENCE_MS })
      : { outcome: "no read" as const, reason: `The run has no rounds of ${BUDGET_CASE} in the arms head and head-copy.`, cases: [] };
  const growthRounds = head.flatMap((record) => {
    const size = sizeOf(record.case);
    return size === undefined ? [] : [{ job: `round-${record.round}`, size, value: record.b }];
  });
  const sizes = new Set(growthRounds.map((round) => round.size)).size;
  const growth =
    sizes >= 2
      ? growthVerdict(growthRounds, { maxGrowth: MAX_GROWTH })
      : { outcome: "no read" as const, steps: [] };
  return {
    cases,
    time: { outcome: time.outcome, reason: time.reason },
    budget: { outcome: budget.outcome, reason: budget.reason, cases: budget.cases },
    growth: {
      outcome: growth.outcome,
      reason: sizes >= 2 ? `The steps of ${sizes} sizes on the grid of 552 regions.` : `The growth needs 2 sizes or more, and the run has ${sizes}.`,
      steps: growth.steps,
    },
  };
}

const fixed = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : String(value));

/** This function gives the report as Markdown for the summary of the run. */
export function markdown(result: Report): string {
  const lines = [
    "## The bench of simplifyRegions (R14)",
    "",
    "| Case | Rounds | base (geo 0.3.1) ms | head ms | head / base | Same result |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...result.cases.map(
      (row) =>
        `| ${row.case} | ${row.rounds} | ${fixed(row.baseMs, 1)} | ${fixed(row.headMs, 1)} | ${fixed(row.ratio, 3)} | ${row.sameResult === undefined ? "no read" : row.sameResult ? "yes" : "NO"} |`,
    ),
    "",
    `- Time (head against base, with the A/A pair): **${result.time.outcome}**. ${result.time.reason}`,
    `- Budget (${BUDGET_CASE}, median of head at most ${BUDGET_MS} ms): **${result.budget.outcome}**. ${result.budget.reason}`,
    `- Growth of head for each 10 times more positions, at most ${MAX_GROWTH}: **${result.growth.outcome}**. ${result.growth.reason}`,
    ...result.growth.steps.map(
      (step) => `  - ${step.from} to ${step.to}: median ${fixed(step.median, 2)} (${fixed(step.low, 2)} to ${fixed(step.high, 2)}), exponent ${fixed(step.exponent, 2)}, ${step.outcome}`,
    ),
    "",
  ];
  return lines.join("\n");
}
