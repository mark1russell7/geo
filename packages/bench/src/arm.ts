/**
 * One arm of the bench in its own process: `node src/arm.ts --geo <base | head> --case <id>`. It makes the map of the
 * case and times one use of `simplifyRegions`. Then it prints one JSON line with the time `ms` and the hash of the result.
 * The time does not include the map or the hash.
 *
 * - The arm `base` is `@mark1russell7/geo` 0.3.1 from npm (the package `geo-base`).
 * - The arm `head` is the source of `packages/geo` in this commit.
 *
 * With the variable `BENCH_HASHES`, the arm also adds a line `{ arm, case, hash }` to that file. The bench compares the
 * hashes of the two arms. The same command with `node --cpu-prof` gives the CPU profile of one arm.
 *
 * @packageDocumentation
 */

import type { Region } from "@mark1russell7/geo";
import fs from "node:fs";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import { caseOf, mapOf, TOLERANCE_KM } from "./map.ts";

type Simplify = (regions: readonly Region[], toleranceKm: number) => Region[];

const args = process.argv.slice(2);
const option = (key: string): string | undefined => {
  const index = args.indexOf(key);
  return index === -1 ? undefined : args[index + 1];
};
const which = option("--geo");
const id = option("--case");
if ((which !== "base" && which !== "head") || id === undefined) {
  console.error("Usage: node src/arm.ts --geo <base | head> --case <id>");
  process.exit(2);
}
const simplify: Simplify =
  which === "base" ? (await import("geo-base")).simplifyRegions : (await import("@mark1russell7/geo")).simplifyRegions;
const regions = mapOf(caseOf(id));
const start = performance.now();
const result = simplify(regions, TOLERANCE_KM);
const ms = performance.now() - start;
const hash = canonicalHash(result);
const file = process.env["BENCH_HASHES"];
if (file !== undefined && file !== "") fs.appendFileSync(file, `${JSON.stringify({ arm: which, case: id, hash })}\n`);
console.log(JSON.stringify({ ms, hash }));
