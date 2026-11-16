/**
 * One arm of the bench in its own process: `node src/arm.ts --suite <simplify | locate | buffer> --geo <base | head>
 * --case <id>`. It makes the input of the case and times one use of the function of the suite. Then it prints one JSON
 * line with the time `ms` and the hash of the result. The time does not include the input, the digest or the hash.
 *
 * - The suite `simplify` times one use of `simplifyRegions` on the map of the case.
 * - The suite `locate` times the location of each place of the case against the polygon of the case. The head uses
 *   `pointLocator`, and the time includes its index. geo 0.3.1 has no locator, so the base uses `locatePoint`.
 * - The suite `buffer` times one use of `bufferKm` on the geometry of the case. The hash is of a digest: the class of
 *   each seeded sample out of the band of the tolerance. Thus each correct buffer gives the same hash. A buffer with a
 *   sample on the wrong side stops the arm with an error.
 * - The arm `base` is the version of `@mark1russell7/geo` from npm that the suite names: 0.3.1 for `simplify` and
 *   `locate`, and 0.4.4 for `buffer`.
 * - The arm `head` is the source of `packages/geo` in this commit.
 *
 * With the variable `BENCH_HASHES`, the arm also adds a line `{ arm, case, hash }` to that file. The bench compares the
 * hashes of the two arms. The same command with `node --cpu-prof` gives the CPU profile of one arm.
 *
 * @packageDocumentation
 */

import fs from "node:fs";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import type { MultiPolygon, Polygon } from "@mark1russell7/geo";
import { bufferCaseOf, bufferGeometryOf, classesOf, expectedClasses, samplesOf } from "./buffers.ts";
import { caseOf, mapOf, TOLERANCE_KM } from "./map.ts";
import { locateCaseOf, placesOf, polygonOf } from "./shapes.ts";
import { suiteOf } from "./suites.ts";

type Geo = typeof import("@mark1russell7/geo");
/** The part of the API of geo that the arms use. geo 0.3.1 has no `pointLocator` and no `bufferKm`. */
type Used = Pick<Geo, "simplifyRegions" | "locatePoint"> & Partial<Pick<Geo, "pointLocator" | "bufferKm">>;

const USAGE = "Usage: node src/arm.ts --suite <simplify | locate | buffer> --geo <base | head> --case <id>";
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
const geo: Used = which === "base" ? await import(suite.base.module) : await import("@mark1russell7/geo");

/** The timed work of a case, and the digest of its result. The time does not include the digest. */
interface Work {
  readonly run: () => unknown;
  readonly digest?: (result: unknown) => unknown;
}

/** This function makes the input of the case, and gives the timed work on it. */
function workOf(): Work {
  if (suite.id === "simplify") {
    const regions = mapOf(caseOf(id as string));
    return { run: () => geo.simplifyRegions(regions, TOLERANCE_KM) };
  }
  if (suite.id === "buffer") {
    const spec = bufferCaseOf(id as string);
    const geometry = bufferGeometryOf(spec);
    const samples = samplesOf(spec, geometry);
    const expected = expectedClasses(spec, geometry, samples);
    const { bufferKm } = geo;
    if (bufferKm === undefined) throw new Error(`geo ${suite.base.version} has no bufferKm`);
    return {
      run: () => bufferKm(geometry, spec.distanceKm, { tolerance: spec.toleranceKm }),
      digest: (buffer) => {
        const classes = classesOf(buffer as Polygon | MultiPolygon, expected, samples);
        if (classes.faults > 0) throw new Error(`The buffer of ${which} puts ${classes.faults} samples on the wrong side on the case ${id}`);
        return classes;
      },
    };
  }
  const spec = locateCaseOf(id as string);
  const polygon = polygonOf(spec);
  const places = placesOf(spec, polygon);
  const { pointLocator } = geo;
  if (pointLocator === undefined) return { run: () => places.map((place) => geo.locatePoint(place, polygon)) };
  return {
    run: () => {
      const locate = pointLocator(polygon);
      return places.map((place) => locate(place));
    },
  };
}

const work = workOf();
const start = performance.now();
const result = work.run();
const ms = performance.now() - start;
const hash = canonicalHash(work.digest === undefined ? result : work.digest(result));
const file = process.env["BENCH_HASHES"];
if (file !== undefined && file !== "") fs.appendFileSync(file, `${JSON.stringify({ arm: which, case: id, hash })}\n`);
console.log(JSON.stringify({ ms, hash }));
