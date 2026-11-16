/**
 * One arm of the bench in its own process: `node src/arm.ts --suite <simplify | locate> --geo <base | head> --case <id>`.
 * It makes the input of the case and times one use of the function of the suite. Then it prints one JSON line with the
 * time `ms` and the hash of the result. The time does not include the input or the hash.
 *
 * - The suite `simplify` times one use of `simplifyRegions` on the map of the case.
 * - The suite `locate` times `locatePoint` for each place of the case, against the polygon of the case.
 * - The arm `base` is `@mark1russell7/geo` 0.3.1 from npm (the package `geo-base`).
 * - The arm `head` is the source of `packages/geo` in this commit.
 *
 * With the variable `BENCH_HASHES`, the arm also adds a line `{ arm, case, hash }` to that file. The bench compares the
 * hashes of the two arms. The same command with `node --cpu-prof` gives the CPU profile of one arm.
 *
 * @packageDocumentation
 */

import fs from "node:fs";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import { caseOf, mapOf, TOLERANCE_KM } from "./map.ts";
import { locateCaseOf, placesOf, polygonOf } from "./shapes.ts";
import { suiteOf } from "./suites.ts";

type Geo = typeof import("@mark1russell7/geo");
/** The part of the API of geo that the arms use. The API of geo 0.3.1 has it too. */
type Used = Pick<Geo, "simplifyRegions" | "locatePoint">;

const USAGE = "Usage: node src/arm.ts --suite <simplify | locate> --geo <base | head> --case <id>";
const args = process.argv.slice(2);
const option = (key: string): string | undefined => {
  const index = args.indexOf(key);
  return index === -1 ? undefined : args[index + 1];
};
const which = option("--geo");
const id = option("--case");
const suiteId = option("--suite") ?? "simplify";
if ((which !== "base" && which !== "head") || id === undefined) {
  console.error(USAGE);
  process.exit(2);
}
const suite = suiteOf(suiteId);
const geo: Used = which === "base" ? await import("geo-base") : await import("@mark1russell7/geo");

/** This function makes the input of the case, and gives the timed work on it. */
function workOf(): () => unknown {
  if (suite.id === "simplify") {
    const regions = mapOf(caseOf(id as string));
    return () => geo.simplifyRegions(regions, TOLERANCE_KM);
  }
  const spec = locateCaseOf(id as string);
  const polygon = polygonOf(spec);
  const places = placesOf(spec, polygon);
  return () => places.map((place) => geo.locatePoint(place, polygon));
}

const work = workOf();
const start = performance.now();
const result = work();
const ms = performance.now() - start;
const hash = canonicalHash(result);
const file = process.env["BENCH_HASHES"];
if (file !== undefined && file !== "") fs.appendFileSync(file, `${JSON.stringify({ arm: which, case: id, hash })}\n`);
console.log(JSON.stringify({ ms, hash }));
