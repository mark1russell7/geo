/**
 * This module makes the report of a run of the bench from its records and its suite. The functions have no input or
 * output, so the tests hold them.
 *
 * - The time verdict compares the pair (base, head) with the A/A pair (base, base) over all cases.
 * - The budget verdict holds the median of the arm `head` on the case of the budget of the suite. Its A/A arm is the
 *   arm `head-copy`: the same code in other processes.
 * - The growth verdict reads the growth of the time of `head` for each 10 times more of the size of the suite. Each
 *   round is one job, so a slow round changes each size of that round.
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
import type { Suite } from "./suites.ts";

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
  readonly suite: Suite["id"];
  readonly cases: readonly CaseRow[];
  readonly time: Read;
  readonly budget: Read & { readonly cases: BudgetVerdict["cases"] };
  readonly growth: Read & { readonly steps: GrowthVerdict["steps"] };
}

/**
 * This function gives the faults of the speed claims of a run, or an empty list. The budget counts when the suite has
 * a budget and the run has its case. The growth counts when the run has 2 or more sizes. Each outcome other than
 * `within` is a fault. Thus a noisy run does not pass. The caller fails the run on a fault only when the suite is
 * enforced.
 */
export function speedFaults(result: Pick<Report, "budget" | "growth">, ids: readonly string[], suite: Suite): string[] {
  const faults: string[] = [];
  const budget = suite.budget;
  if (budget !== undefined && ids.includes(budget.case) && result.budget.outcome !== "within") {
    faults.push(`The budget of ${budget.case} is "${result.budget.outcome}". ${result.budget.reason}`);
  }
  if (new Set(ids.map(suite.growth.sizeOf).filter((size) => size !== undefined)).size >= 2 && result.growth.outcome !== "within") {
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

/** This function makes the report of a run of the suite. */
export function report(pairs: Pairs, hashes: readonly HashLine[], suite: Suite): Report {
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
  const claim = suite.budget;
  const budgetRounds = (records: readonly PairedTime[], id: string): BudgetRound[] =>
    records.filter((record) => record.case === id).map((record) => ({ case: record.case, round: record.round, value: record.b }));
  const headBudget = claim === undefined ? [] : budgetRounds(head, claim.case);
  const copyBudget = claim === undefined ? [] : budgetRounds(copy, claim.case);
  const budget =
    claim !== undefined && headBudget.length > 0 && copyBudget.length > 0
      ? budgetVerdict(headBudget, copyBudget, { limit: claim.limitMs, maxDifference: claim.maxDifferenceMs })
      : {
          outcome: "no read" as const,
          reason: claim === undefined ? "The suite has no budget." : `The run has no rounds of ${claim.case} in the arms head and head-copy.`,
          cases: [],
        };
  const growthRounds = head.flatMap((record) => {
    const size = suite.growth.sizeOf(record.case);
    return size === undefined ? [] : [{ job: `round-${record.round}`, size, value: record.b }];
  });
  const sizes = new Set(growthRounds.map((round) => round.size)).size;
  const growth = sizes >= 2 ? growthVerdict(growthRounds, { maxGrowth: suite.growth.maxGrowth }) : { outcome: "no read" as const, steps: [] };
  return {
    suite: suite.id,
    cases,
    time: { outcome: time.outcome, reason: time.reason },
    budget: { outcome: budget.outcome, reason: budget.reason, cases: budget.cases },
    growth: {
      outcome: growth.outcome,
      reason: sizes >= 2 ? `The steps of ${sizes} sizes: ${suite.growth.describe}.` : `The growth needs 2 sizes or more, and the run has ${sizes}.`,
      steps: growth.steps,
    },
  };
}

const fixed = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : String(value));

/** This function gives the report as Markdown for the summary of the run. */
export function markdown(result: Report, suite: Suite): string {
  const claim = suite.budget;
  const mode = suite.enforced ? "The speed gate holds the budget and the growth." : "The report only reads the speed claims. They do not fail the run.";
  const lines = [
    `## ${suite.title}`,
    "",
    `| Case | Rounds | base (geo ${suite.base.version}) ms | head ms | head / base | Same result |`,
    "| --- | ---: | ---: | ---: | ---: | --- |",
    ...result.cases.map(
      (row) =>
        `| ${row.case} | ${row.rounds} | ${fixed(row.baseMs, 1)} | ${fixed(row.headMs, 1)} | ${fixed(row.ratio, 3)} | ${row.sameResult === undefined ? "no read" : row.sameResult ? "yes" : "NO"} |`,
    ),
    "",
    mode,
    "",
    `- Time (head against base, with the A/A pair): **${result.time.outcome}**. ${result.time.reason}`,
    claim === undefined
      ? `- Budget: **${result.budget.outcome}**. ${result.budget.reason}`
      : `- Budget (${claim.case}, median of head at most ${claim.limitMs} ms): **${result.budget.outcome}**. ${result.budget.reason}`,
    `- Growth of head for each 10 times more, at most ${suite.growth.maxGrowth}: **${result.growth.outcome}**. ${result.growth.reason}`,
    ...result.growth.steps.map(
      (step) => `  - ${step.from} to ${step.to}: median ${fixed(step.median, 2)} (${fixed(step.low, 2)} to ${fixed(step.high, 2)}), exponent ${fixed(step.exponent, 2)}, ${step.outcome}`,
    ),
    "",
  ];
  return lines.join("\n");
}
