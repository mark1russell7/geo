/**
 * The bench of `@mark1russell7/geo`: the suite `simplify` of `simplifyRegions` (roadmap item R14), the suite `locate`
 * of `pointLocator` (roadmap item R10) and the suite `buffer` of `bufferKm` (roadmap item R16). This entry gives the seeded inputs of the cases, the suites and the
 * report of a run, so the tests can hold them. The scripts `src/bench.ts` and `src/arm.ts` start the run.
 *
 * @packageDocumentation
 */

export { CASES, caseOf, type MapSpec, mapOf, positionCount, TOLERANCE_KM } from "./map.ts";
export { LOCATE_CASES, locateCaseOf, type LocateSpec, placesOf, polygonOf, positionsOf, type Shape } from "./shapes.ts";
export {
  BUFFER_CASES,
  type BufferShape,
  type BufferSpec,
  bufferCaseOf,
  bufferGeometryOf,
  classesOf,
  expectedClasses,
  type SampleClasses,
  samplesOf,
} from "./buffers.ts";
export { BUFFER, type BudgetClaim, type GrowthClaim, LOCATE, SIMPLIFY, type Suite, type SuiteBase, type SuiteId, SUITES, suiteOf } from "./suites.ts";
export { type CaseRow, type HashLine, markdown, type Pairs, type Read, type Report, report, speedFaults } from "./report.ts";
