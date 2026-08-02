/**
 * Harness unit tests — Layer 1 (hermetic): summarize() math incl. Wilson
 * bounds, value-accuracy matching, the schema sample path with a fake
 * adapter (native + json_mode rungs), and the envelope guard.
 */

import { describe, expect, it } from "vitest";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "modelrig";
import { resolveCandidates } from "modelrig";
import {
  ProbeBudgetExceededError,
  runSchemaSample,
  sampleFixtures,
  stripFence,
  summarize,
  valueAccuracy,
  valueAtPath,
  wilson95,
} from "./harness";
import type { SampleContext } from "./harness";
import type { ProbeFixture, ProbeSample } from "./types";

const FIXTURE: ProbeFixture = {
  id: "fx-1",
  class: "schema",
  domain: "general",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["value", "label"],
    properties: { value: { type: "number" }, label: { type: "string" } },
  },
  prompt: "Extract value and label.",
  expectedValues: { value: 42, label: "answer" },
  source: "test",
};

function sample(overrides: Partial<ProbeSample> = {}): ProbeSample {
  return {
    parseOk: true,
    schemaConform: true,
    valueAccuracy: 1,
    grounded: null,
    citationCount: null,
    cachedTokens: null,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.001,
    latencyMs: 500,
    failureClass: null,
    ...overrides,
  };
}

function fakeContext(
  results: AdapterResult[],
  structuredNative: boolean
): SampleContext & { requests: AdapterRequest[] } {
  const requests: AdapterRequest[] = [];
  let i = 0;
  const adapter: ProviderAdapter = {
    id: "openai",
    supports: (flag) => (flag === "structured_native" ? structuredNative : false),
    call: async (req) => {
      requests.push(req);
      const next = results[Math.min(i, results.length - 1)];
      i += 1;
      return next;
    },
  };
  const iter = resolveCandidates(
    {
      route: "probe.test",
      version: 1,
      outputSchema: null,
      candidates: [{ provider: "openai", model: "test-model" }],
      require: [],
      prefer: [],
      systemTemplate: "",
      variables: [],
      policy: { retries: {}, timeoutMs: 1000, tier: "standard", json: "native" },
      fingerprintCell: null,
    },
    () => new Set(),
    () => null
  );
  const candidate = iter.next();
  if (candidate === null) throw new Error("unreachable: probe route has one candidate");
  return { adapter, candidate, provider: "openai", model: "test-model", requests };
}

function ok(text: string): AdapterResult {
  return {
    ok: true,
    text,
    usage: { tokensIn: 100, tokensOut: 50, tokensCached: 0, servedTier: "standard" },
  };
}

describe("wilson95", () => {
  it("brackets the point estimate and stays inside [0,1]", () => {
    const [low, high] = wilson95(4, 5);
    expect(low).toBeGreaterThan(0.3);
    expect(low).toBeLessThan(0.8);
    expect(high).toBeGreaterThan(0.8);
    expect(high).toBeLessThanOrEqual(1);
  });

  it("handles 0/n and n/n without leaving [0,1]", () => {
    const [zeroLow, zeroHigh] = wilson95(0, 5);
    expect(zeroLow).toBe(0);
    expect(zeroHigh).toBeGreaterThan(0);
    const [fullLow, fullHigh] = wilson95(5, 5);
    expect(fullLow).toBeLessThan(1);
    expect(fullHigh).toBe(1);
  });

  it("narrows as n grows", () => {
    const [l5, h5] = wilson95(4, 5);
    const [l100, h100] = wilson95(80, 100);
    expect(h100 - l100).toBeLessThan(h5 - l5);
  });
});

describe("summarize", () => {
  it("computes rates, accuracy mean, CI, and mean cost", () => {
    const stats = summarize("fx", [
      sample(),
      sample({ schemaConform: false, valueAccuracy: 0.5 }),
      sample({ parseOk: false, schemaConform: false, valueAccuracy: null, costUsd: 0.002 }),
    ]);
    expect(stats.samples).toBe(3);
    expect(stats.parseRate).toBeCloseTo(2 / 3);
    expect(stats.conformRate).toBeCloseTo(1 / 3);
    expect(stats.valueAccuracyMean).toBeCloseTo(0.75);
    expect(stats.conformCi95).not.toBeNull();
    expect(stats.meanCostUsd).toBeCloseTo(0.004 / 3);
  });

  it("returns nulls for unjudgeable dimensions", () => {
    const stats = summarize("fx", [
      sample({ schemaConform: null, valueAccuracy: null }),
      sample({ schemaConform: null, valueAccuracy: null }),
    ]);
    expect(stats.conformRate).toBeNull();
    expect(stats.conformCi95).toBeNull();
    expect(stats.valueAccuracyMean).toBeNull();
  });

  it("handles the empty-sample edge", () => {
    const stats = summarize("fx", []);
    expect(stats.samples).toBe(0);
    expect(stats.conformRate).toBeNull();
  });
});

describe("valueAccuracy / valueAtPath", () => {
  it("resolves dot paths through objects and arrays", () => {
    const root = { a: { items: [{ qty: 3 }, { qty: 7 }] } };
    expect(valueAtPath(root, "a.items.1.qty")).toBe(7);
    expect(valueAtPath(root, "a.missing.x")).toBeUndefined();
  });

  it("scores numeric tolerance and case-insensitive strings", () => {
    const parsed = { value: 42.0000001, label: " Answer " };
    expect(valueAccuracy(parsed, { value: 42, label: "answer" })).toBe(1);
    expect(valueAccuracy(parsed, { value: 43, label: "answer" })).toBe(0.5);
  });

  it("returns null when no expected values are declared", () => {
    expect(valueAccuracy({}, undefined)).toBeNull();
  });
});

describe("stripFence", () => {
  it("removes a wrapping ```json fence", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("leaves unfenced content alone", () => {
    expect(stripFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("runSchemaSample", () => {
  it("native rung: passes the schema to the adapter and validates output", async () => {
    const ctx = fakeContext([ok('{"value": 42, "label": "answer"}')], true);
    const result = await runSchemaSample(ctx, FIXTURE);
    expect(result.rung).toBe("native");
    expect(ctx.requests[0].outputSchema).toEqual(FIXTURE.schema);
    expect(ctx.requests[0].systemPrompt).toBe(FIXTURE.prompt); // no coaching on native
    expect(result.parseOk).toBe(true);
    expect(result.schemaConform).toBe(true);
    expect(result.valueAccuracy).toBe(1);
  });

  it("json_mode rung: coaches the schema into the prompt instead", async () => {
    const ctx = fakeContext([ok('{"value": 42, "label": "answer"}')], false);
    const result = await runSchemaSample(ctx, FIXTURE);
    expect(result.rung).toBe("json_mode");
    expect(ctx.requests[0].outputSchema).toBeNull();
    expect(ctx.requests[0].systemPrompt).toContain("OUTPUT FORMAT (STRICT)");
    expect(ctx.requests[0].systemPrompt).toContain('"required":["value","label"]');
    expect(result.schemaConform).toBe(true);
  });

  it("distinguishes parses-but-nonconformant from parse failure", async () => {
    const nonconform = await runSchemaSample(
      fakeContext([ok('{"value": "not-a-number", "label": "answer"}')], true),
      FIXTURE
    );
    expect(nonconform.parseOk).toBe(true);
    expect(nonconform.schemaConform).toBe(false);

    const unparseable = await runSchemaSample(fakeContext([ok("I think the answer is 42")], true), FIXTURE);
    expect(unparseable.parseOk).toBe(false);
    expect(unparseable.schemaConform).toBe(false);
  });

  it("records adapter failures as failed samples with the failure class", async () => {
    const ctx = fakeContext(
      [{ ok: false, failure: { class: "capacity_shed", message: "shed" } }],
      true
    );
    const result = await runSchemaSample(ctx, FIXTURE);
    expect(result.failureClass).toBe("capacity_shed");
    expect(result.parseOk).toBe(false);
    expect(result.costUsd).toBe(0);
  });
});

describe("sampleFixtures — envelope guard", () => {
  it("throws typed ProbeBudgetExceededError once spend crosses the envelope, retaining partials", async () => {
    const ctx = fakeContext([ok('{"value": 42, "label": "answer"}')], true);
    const spendyRunner = async (): Promise<ProbeSample> => sample({ costUsd: 0.6 });

    await expect(
      sampleFixtures(ctx, "openai/test-model", "schema", [FIXTURE], 5, 1.0, spendyRunner)
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ProbeBudgetExceededError);
      const typed = err as ProbeBudgetExceededError;
      expect(typed.spentUsd).toBeCloseTo(1.2);
      expect(typed.partial.raw["fx-1"]).toHaveLength(2); // 2 samples before breach
      return true;
    });
  });

  it("assembles a complete result under budget with hashes, stats, and totals", async () => {
    const ctx = fakeContext([ok('{"value": 42, "label": "answer"}')], true);
    const result = await sampleFixtures(
      ctx,
      "openai/test-model",
      "schema",
      [FIXTURE],
      3,
      5,
      runSchemaSample
    );
    expect(result.modelKey).toBe("openai/test-model");
    expect(result.class).toBe("schema");
    expect(result.raw["fx-1"]).toHaveLength(3);
    expect(result.stats[0].conformRate).toBe(1);
    expect(result.fixtureHashes["fx-1"]).toMatch(/^[0-9a-f]{16}$/);
    expect(result.harnessVersion).toBeTruthy();
  });
});
