/**
 * Verification tests: integrity recompute (tamper detection) and the
 * reproducibility comparison against a published interval.
 */

import { describe, expect, it } from "vitest";
import { assembleResult, summarize } from "./harness";
import { compareResults, verifyResult } from "./verify";
import type { ProbeFixture, ProbeResult, ProbeSample } from "./types";

const FIXTURE: ProbeFixture = {
  id: "fx",
  class: "schema",
  schema: { type: "object" },
  prompt: "p",
  source: "test",
};

function sample(conform: boolean): ProbeSample {
  return {
    parseOk: true,
    schemaConform: conform,
    valueAccuracy: conform ? 1 : 0,
    grounded: null,
    citationCount: null,
    cachedTokens: null,
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.001,
    latencyMs: 10,
    failureClass: null,
  };
}

function result(samples: ProbeSample[]): ProbeResult {
  return assembleResult("openai/m", "schema", [FIXTURE], { fx: samples }, "0.0.1-test");
}

describe("verifyResult", () => {
  it("passes when stats match the raw records", () => {
    const r = result([sample(true), sample(true), sample(false)]);
    expect(verifyResult(r).ok).toBe(true);
  });

  it("fails when the stats block was tampered with", () => {
    const r = result([sample(true), sample(false)]);
    const tampered: ProbeResult = {
      ...r,
      stats: [{ ...summarize("fx", [sample(true), sample(false)]), conformRate: 1 }],
    };
    const report = verifyResult(tampered);
    expect(report.ok).toBe(false);
    expect(report.fixtures[0].statsMatch).toBe(false);
  });
});

describe("compareResults", () => {
  it("accepts a fresh rate inside the published CI", () => {
    const published = result([sample(true), sample(true), sample(true), sample(false), sample(true)]);
    const fresh = result([sample(true), sample(true), sample(true), sample(true), sample(false)]);
    const report = compareResults(fresh, published);
    expect(report.checks[0].comparable).toBe(true);
    expect(report.ok).toBe(true);
  });

  it("rejects a fresh rate outside the published CI", () => {
    const published = result([sample(true), sample(true), sample(true), sample(true), sample(true)]);
    const fresh = result([sample(false), sample(false), sample(false), sample(false), sample(false)]);
    const report = compareResults(fresh, published);
    expect(report.ok).toBe(false);
    expect(report.checks[0].withinCi).toBe(false);
  });

  it("marks runs with differing fixture hashes as not comparable", () => {
    const published = result([sample(true)]);
    const fresh = result([sample(true)]);
    const mutated: ProbeResult = { ...fresh, fixtureHashes: { fx: "deadbeefdeadbeef" } };
    const report = compareResults(mutated, published);
    expect(report.checks[0].comparable).toBe(false);
    expect(report.checks[0].reason).toContain("hash differs");
  });
});
