/**
 * The bench: `node src/bench.ts --suite <simplify | locate> --out <folder> [--rounds 7] [--cases <id,id>] [--timeout-ms 180000]`.
 *
 * It starts each arm of each pair, case and round in a fresh process with `freshRun` of `@mark1russell7/rigor-bench`.
 * The pairs are (base, head), (base, head-copy) and the A/A pair (base, base). The arm `base` is geo 0.3.1 from npm, and
 * the arms `head` and `head-copy` are the source of this commit. The suites are in `suites.ts`.
 *
 * It writes the records of each pair to `records-<pair>.jsonl` and the skips to `skipped.json`. It writes the hashes of
 * the results to `hashes.jsonl` and the facts of the computer to `env.json`. The report goes to `report.json` and
 * `report.md`. The workflows `bench-simplify.yml` and `bench-locate.yml` start it in CI. Do not start a full run on a
 * shared computer.
 *
 * The exit code is 1 when a case has no read, or when `head` and `base` give different results on a case. In an
 * enforced suite, it is also 1 when the speed gate has a fault: the budget or the growth is not `within`. The speed
 * read also goes to the check of the run as one gate line.
 *
 * @packageDocumentation
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateLine, writeGateLine } from "@mark1russell7/rigor-bench";
import { freshRun } from "@mark1russell7/rigor-bench/fresh";
import { type HashLine, markdown, report, speedFaults } from "./report.ts";
import { suiteOf } from "./suites.ts";

const USAGE = "Usage: node src/bench.ts --suite <simplify | locate> --out <folder> [--rounds 7] [--cases <id,id>] [--timeout-ms 180000]";
const args = process.argv.slice(2);
const option = (key: string, fallback?: string): string | undefined => {
  const index = args.indexOf(key);
  return index === -1 ? fallback : args[index + 1];
};
const out = option("--out");
const suiteId = option("--suite", "simplify") as string;
const rounds = Number(option("--rounds", "7"));
const timeoutMs = Number(option("--timeout-ms", "180000"));
const listed = option("--cases", "");
if (out === undefined || !Number.isSafeInteger(rounds) || rounds < 1 || !(timeoutMs > 0)) {
  console.error(USAGE);
  process.exit(2);
}
const suite = suiteOf(suiteId);
const names = listed === undefined || listed === "" ? suite.cases : listed.split(",");
const unknown = names.filter((id) => !suite.cases.includes(id));
if (unknown.length > 0) {
  console.error(`The suite ${suite.id} has no case ${unknown.join(", ")}. The cases: ${suite.cases.join(", ")}`);
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const hashFile = path.resolve(out, "hashes.jsonl");
fs.writeFileSync(hashFile, "");
process.env["BENCH_HASHES"] = hashFile;

const arm = path.join(path.dirname(fileURLToPath(import.meta.url)), "arm.ts");
const command = (geo: "base" | "head"): string[] => [process.execPath, arm, "--suite", suite.id, "--geo", geo];
const run = await freshRun({
  base: { id: "base", command: command("base") },
  candidates: [
    { id: "head", command: command("head") },
    { id: "head-copy", command: command("head") },
  ],
  cases: names,
  rounds,
  timeoutMs,
  overLimit: "skip",
});

const jsonl = (rows: readonly unknown[]): string => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
for (const [pair, records] of Object.entries(run.pairs)) fs.writeFileSync(path.join(out, `records-${pair}.jsonl`), jsonl(records));
fs.writeFileSync(path.join(out, "skipped.json"), JSON.stringify(run.skipped, null, 2) + "\n");
fs.writeFileSync(path.join(out, "env.json"), JSON.stringify(run.env, null, 2) + "\n");
const hashes = fs
  .readFileSync(hashFile, "utf8")
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => JSON.parse(line) as HashLine);
const result = report(run.pairs, hashes, suite);
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ env: run.env, skipped: run.skipped, ...result }, null, 2) + "\n");
const text = markdown(result, suite) + (run.skipped.length > 0 ? `\nSkipped: ${run.skipped.map((skip) => `${skip.case} (${skip.arm}: ${skip.reason})`).join(", ")}\n` : "");
fs.writeFileSync(path.join(out, "report.md"), text);
console.log(text);

// The gate of the result: each case of the run has one hash in each arm, and the hashes are the same.
// A case with no hash (a skip or a fault) is no read, and no read is not a pass.
const unsure = names.filter((id) => result.cases.find((row) => row.case === id)?.sameResult !== true);
if (unsure.length > 0) {
  console.error(`The result of head is not the same as the result of geo 0.3.1, or has no read, on: ${unsure.join(", ")}`);
  process.exitCode = 1;
}

// The speed claims: the budget and the growth of head. A noisy verdict is a fault, so a noisy run does not pass.
// The gate line shows the read on the check of the run. Only an enforced suite fails the run on a fault.
const faults = speedFaults(result, names, suite);
const sizes = new Set(names.map(suite.growth.sizeOf).filter((size) => size !== undefined)).size;
const reads = [
  ...(suite.budget !== undefined && names.includes(suite.budget.case) ? [{ case: `budget of ${suite.budget.case}`, outcome: result.budget.outcome }] : []),
  ...(sizes >= 2 ? [{ case: "growth", outcome: result.growth.outcome }] : []),
];
if (reads.length > 0) writeGateLine(gateLine(reads, { title: suite.title, enforced: suite.enforced }));
for (const fault of faults) console.error(`Speed ${suite.enforced ? "gate" : "read"}: ${fault}`);
if (suite.enforced && faults.length > 0) process.exitCode = 1;
