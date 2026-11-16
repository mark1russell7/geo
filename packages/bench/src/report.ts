/**
 * This module makes the report of a run of the bench from its records and its suite. The functions have no input or
 * output, so the tests hold them.
 *
 * - The time verdict compares the pair (base, head) with the A/A pair (base, base) over all cases.
 * - The budget verdict holds the median of the arm `head` on the case of the budget of the suite. Its A/A arm is the
 *   arm `head-copy`: the same code in other processes. The verdict looks at 6, 12 and 24 rounds with
 *   `budgetLooksVerdict` of `@mark1russell7/rigor-bench`. A noisy look gives no outcome, and the bench adds rounds.
 * - The growth verdict reads the growth of the time of `head` for each 10 times more of the size of the suite. Each
 *   round is one job, so a slow round changes each size of that round.
 * - The hashes show if `base` and `head` give the same result on each case.
 * - The speed gate holds the budget and the growth of `head`. A verdict that cannot decide does not pass the gate.
 *
 * @packageDocumentation
 */

import {
  budgetLooksVerdict,
  type BudgetRound,
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

/** The rounds of the case of the budget in the two arms of `head`. */
export interface BudgetRounds {
  readonly head: readonly BudgetRound[];
  readonly copy: readonly BudgetRound[];
}

/** The read of the budget. The field `more` is the count of rounds that each arm of `head` needs for the next look, or 0. */
export interface BudgetRead extends Read {
  readonly cases: BudgetVerdict["cases"];
  readonly more: number;
}

export interface Report {
  readonly suite: Suite["id"];
  readonly cases: readonly CaseRow[];
  readonly time: Read;
  readonly budget: BudgetRead;
  readonly growth: Read & { readonly steps: GrowthVerdict["steps"] };
}

/** The empty list of added rounds. */
export const NO_ROUNDS: BudgetRounds = { head: [], copy: [] };

/**
 * This function gives the rounds of the case of the budget in a run: the time `b` of the pairs `head` and `head-copy`.
 * The list is empty when the suite has no budget.
 */
export function budgetRounds(pairs: Pairs, suite: Suite): BudgetRounds {
  const claim = suite.budget;
  if (claim === undefined) return NO_ROUNDS;
  const of = (records: readonly PairedTime[]): BudgetRound[] =>
    records.filter((record) => record.case === claim.case).map((record) => ({ case: record.case, round: record.round, value: record.b }));
  return { head: of(pairs["head"] ?? []), copy: of(pairs["head-copy"] ?? []) };
}

/**
 * This function adds the records of a pair (head, head-copy) to the rounds of the budget. The time `a` is the time of
 * `head`, and the time `b` is the time of `head-copy`.
 */
export function addRounds(rounds: BudgetRounds, records: readonly PairedTime[]): BudgetRounds {
  return {
    head: [...rounds.head, ...records.map((record) => ({ case: record.case, round: record.round, value: record.a }))],
    copy: [...rounds.copy, ...records.map((record) => ({ case: record.case, round: record.round, value: record.b }))],
  };
}

/**
 * This function gives the read of the budget from its rounds. A look with no outcome, for example a look with an A/A
 * difference above the limit, asks for more rounds in `more`. The last look at 24 rounds gives its outcome.
 */
export function budgetRead(rounds: BudgetRounds, suite: Suite): BudgetRead {
  const claim = suite.budget;
  if (claim === undefined) return { outcome: "no read", reason: "The suite has no budget.", cases: [], more: 0 };
  if (rounds.head.length === 0 || rounds.copy.length === 0) {
    return { outcome: "no read", reason: `The run has no rounds of ${claim.case} in the arms head and head-copy.`, cases: [], more: 0 };
  }
  const verdict = budgetLooksVerdict(rounds.head, rounds.copy, { limit: claim.limitMs, maxDifference: claim.maxDifferenceMs });
  const next = verdict.more.find((item) => item.case === claim.case)?.rounds;
  const more = next === undefined ? 0 : Math.max(0, next - Math.min(rounds.head.length, rounds.copy.length));
  return { outcome: verdict.outcome, reason: verdict.reason, cases: verdict.cases, more };
}

/**
 * The function that measures more rounds of the case `id` of the budget in a pair (head, head-copy). The rounds start
 * at the round `from`. A skip gives no record.
 */
export type MeasureRounds = (id: string, rounds: number, from: number) => Promise<readonly PairedTime[]>;

/** The rounds that `addBudgetRounds` added: the records of the pair (head, head-copy), and the rounds for `report`. */
export interface AddedRounds {
  readonly records: readonly PairedTime[];
  readonly added: BudgetRounds;
}

/**
 * This function adds rounds of the case of the budget while a look has no outcome, up to the last look at 24 rounds.
 * It stops when a measure gives no records. A suite with no budget, or a run with no rounds of its case, adds nothing.
 */
export async function addBudgetRounds(pairs: Pairs, suite: Suite, measure: MeasureRounds): Promise<AddedRounds> {
  const own = budgetRounds(pairs, suite);
  const records: PairedTime[] = [];
  let added = NO_ROUNDS;
  for (;;) {
    const all = { head: [...own.head, ...added.head], copy: [...own.copy, ...added.copy] };
    const more = budgetRead(all, suite).more;
    const id = suite.budget?.case;
    if (more === 0 || id === undefined) break;
    const found = await measure(id, more, 1 + Math.max(...all.head.map((item) => item.round)));
    if (found.length === 0) break;
    records.push(...found);
    added = addRounds(added, found);
  }
  return { records, added };
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

/**
 * This function makes the report of a run of the suite. The rounds `added` are the rounds of the budget that the bench
 * added after the run, with `addRounds`.
 */
export function report(pairs: Pairs, hashes: readonly HashLine[], suite: Suite, added: BudgetRounds = NO_ROUNDS): Report {
  const head = pairs["head"] ?? [];
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
  const own = budgetRounds(pairs, suite);
  const budget = budgetRead({ head: [...own.head, ...added.head], copy: [...own.copy, ...added.copy] }, suite);
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
    budget,
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
      : `- Budget (${claim.case}, median of head at most ${claim.limitMs} ms, looks at 6, 12 and 24 rounds): **${result.budget.outcome}**. ${result.budget.reason}`,
    `- Growth of head for each 10 times more, at most ${suite.growth.maxGrowth}: **${result.growth.outcome}**. ${result.growth.reason}`,
    ...result.growth.steps.map(
      (step) => `  - ${step.from} to ${step.to}: median ${fixed(step.median, 2)} (${fixed(step.low, 2)} to ${fixed(step.high, 2)}), exponent ${fixed(step.exponent, 2)}, ${step.outcome}`,
    ),
    "",
  ];
  return lines.join("\n");
}
