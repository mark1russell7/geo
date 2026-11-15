/**
 * The bench of `simplifyRegions` (roadmap item R14). This entry gives the seeded maps of the cases and the report of a
 * run, so the tests can hold them. The scripts `src/bench.ts` and `src/arm.ts` start the run.
 *
 * @packageDocumentation
 */

export { CASES, caseOf, type MapSpec, mapOf, positionCount, TOLERANCE_KM } from "./map.ts";
export {
  BUDGET_CASE,
  BUDGET_DIFFERENCE_MS,
  BUDGET_MS,
  type CaseRow,
  type HashLine,
  MAX_GROWTH,
  markdown,
  type Pairs,
  type Read,
  type Report,
  report,
  speedFaults,
} from "./report.ts";
