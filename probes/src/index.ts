/**
 * modelrig-probes — empirical capability verification for the ModelRig
 * registry. Public API: fixtures, harness, verification. The CLI (cli.ts)
 * is the primary surface: `npx modelrig-probes run --model provider/model`.
 */

export type {
  FixtureStats,
  ProbeClass,
  ProbeFixture,
  ProbeResult,
  ProbeSample,
} from "./types";
export { canonicalJson, fixtureHash, loadFixtures } from "./fixtures";
export {
  ProbeBudgetExceededError,
  assembleResult,
  jsonModeCoaching,
  runProbe,
  runSchemaSample,
  sampleFixtures,
  stripFence,
  summarize,
  valueAccuracy,
  valueAtPath,
  wilson95,
} from "./harness";
export type { HarnessConfig, SampleContext, SampleRunner } from "./harness";
export { readResult, resultPath, writeResult } from "./results";
export { compareResults, verifyResult } from "./verify";
export type { ReproducibilityReport, VerifyReport } from "./verify";
export { loadProbesConfigFromEnv } from "./config";
export type { ProbesConfig } from "./config";
export { parseModelKey, resolveModel } from "./providers";
