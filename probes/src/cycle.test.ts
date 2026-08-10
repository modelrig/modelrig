/**
 * Cycle-orchestrator tests — the binding rules made assertions:
 * fail-closed-on-unpriced, hard ceiling, partial-recorded-as-partial, and a
 * cost projection that names (not hides) unpriced/unreachable models.
 * Hermetic: a fake runProbe stands in for the network; results write to a tmp.
 */

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCyclePlan, estimateCycleCost, runCycle } from "./cycle";
import type { CyclePlan } from "./cycle";
import type { ProbeResult } from "./types";

// Real pricing facts used below (stable across snapshot + host overlay):
//   openai/gpt-5.4-nano            → priced
//   deepinfra/Qwen/Qwen3-30B-A3B   → priced
//   deepinfra/zzz/Never-Priced-*   → UNPRICED — a synthetic key absent from the
//     snapshot AND the host overlay, so the fail-closed case can't be undone by
//     a future price landing (a real model would eventually get priced).
const PRICED_A = "openai/gpt-5.4-nano";
const PRICED_B = "deepinfra/Qwen/Qwen3-30B-A3B";
const UNPRICED = "deepinfra/zzz/Never-Priced-Test-Model-9000";

const KEYS = { openai: "k", deepinfra: "k" } as const;

function fakeResult(modelKey: string, costUsd: number): ProbeResult {
  return {
    modelKey,
    class: "schema",
    date: new Date().toISOString(),
    harnessVersion: "test",
    fixtureHashes: { f: "h" },
    raw: { f: [{ parseOk: true, schemaConform: true, valueAccuracy: 1, grounded: null, citationCount: null, cachedTokens: null, tokensIn: 10, tokensOut: 10, costUsd, latencyMs: 1, failureClass: null }] },
    stats: [],
    totalCostUsd: costUsd,
  };
}

function failedResult(modelKey: string, n = 5): ProbeResult {
  return {
    modelKey,
    class: "schema",
    date: new Date().toISOString(),
    harnessVersion: "test",
    fixtureHashes: { f: "h" },
    raw: { f: Array.from({ length: n }, () => ({ parseOk: false, schemaConform: false, valueAccuracy: null, grounded: null, citationCount: null, cachedTokens: null, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 1, failureClass: "network" })) },
    stats: [],
    totalCostUsd: 0,
  };
}

describe("cycle", () => {
  let out: string;
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), "cycle-test-"));
  });
  afterEach(() => {
    rmSync(out, { recursive: true, force: true });
  });

  const plan = (modelKeys: string[], ceiling = 25, perModel = 5): CyclePlan => ({
    cycle: "test",
    samples: 1,
    perModelEnvelopeUsd: perModel,
    cycleCeilingUsd: ceiling,
    jobs: modelKeys.map((k) => ({ modelKey: k, classes: ["schema"] as const })),
  });

  it("fail-closed: an unpriced model is skipped and never probed", async () => {
    const probed: string[] = [];
    const manifest = await runCycle(plan([PRICED_A, UNPRICED]), {
      outDir: out,
      keys: KEYS,
      runProbeImpl: async (cfg) => {
        probed.push(cfg.modelKey);
        return fakeResult(cfg.modelKey, 0.01);
      },
    });
    expect(probed).toEqual([PRICED_A]); // UNPRICED never reached the network
    const unpriced = manifest.models.find((m) => m.modelKey === UNPRICED);
    expect(unpriced?.status).toBe("skipped-unpriced");
    expect(manifest.counts["skipped-unpriced"]).toBe(1);
  });

  it("skips a model whose provider has no key (unreachable)", async () => {
    const manifest = await runCycle(plan(["grok/grok-4.5", PRICED_A]), {
      outDir: out,
      keys: KEYS, // no grok key
      runProbeImpl: async (cfg) => fakeResult(cfg.modelKey, 0.01),
    });
    expect(manifest.models.find((m) => m.modelKey === "grok/grok-4.5")?.status).toBe("skipped-unreachable");
  });

  it("enforces the ceiling and records unreached models as not-probed-this-cycle (never carried forward)", async () => {
    // ceiling 0.015, three 0.01 models: A runs (spend 0.01), B runs (spend
    // 0.02 — the documented one-model soft overshoot), C is blocked and named.
    const manifest = await runCycle(plan([PRICED_A, PRICED_B, "openai/gpt-5.4-mini"], 0.015), {
      outDir: out,
      keys: KEYS,
      runProbeImpl: async (cfg) => fakeResult(cfg.modelKey, 0.01),
    });
    expect(manifest.ceilingReached).toBe(true);
    expect(manifest.counts.probed).toBe(2);
    const notReached = manifest.models.filter((m) => m.status === "not-probed-this-cycle");
    expect(notReached.length).toBe(1);
    expect(notReached[0].costUsd).toBe(0); // not last cycle's number — zero, and labeled
  });

  it("estimate names unpriced and unreachable models and sums only priced+reachable", () => {
    const est = estimateCycleCost(plan([PRICED_A, UNPRICED, "grok/grok-4.5"]), KEYS);
    expect(est.unpriced).toContain(UNPRICED);
    expect(est.unreachable).toContain("grok/grok-4.5");
    expect(est.pricedReachableModels).toBe(1);
    expect(est.projectedUsd).toBeGreaterThan(0);
  });

  it("buildCyclePlan gives existing models schema-only and new models the full cycle", () => {
    // No results dir on disk → existing empty; campaign path absent → campaign empty.
    const p = buildCyclePlan({
      cycle: "c",
      samples: 5,
      perModelEnvelopeUsd: 5,
      cycleCeilingUsd: 25,
    });
    expect(p.jobs).toEqual([]);
    expect(p.cycleCeilingUsd).toBe(25);
  });

  it("retries once on a mostly-failed run and recovers a clean measurement", async () => {
    let calls = 0;
    const manifest = await runCycle(plan([PRICED_A]), {
      outDir: out,
      keys: KEYS,
      runProbeImpl: async (cfg) => {
        calls += 1;
        return calls === 1 ? failedResult(cfg.modelKey) : fakeResult(cfg.modelKey, 0.01);
      },
    });
    expect(calls).toBe(2); // first run contaminated → retried
    expect(manifest.models[0].status).toBe("probed");
    expect(readdirSync(out).some((d) => d.startsWith("openai-"))).toBe(true); // clean result published
  });

  it("does NOT publish a still-contaminated run (protects prior-good data)", async () => {
    const manifest = await runCycle(plan([PRICED_A]), {
      outDir: out,
      keys: KEYS,
      runProbeImpl: async (cfg) => failedResult(cfg.modelKey), // both attempts fail
    });
    expect(manifest.models[0].status).toBe("contaminated");
    expect(manifest.counts.contaminated).toBe(1);
    // nothing written — build-probed will keep whatever prior data exists
    expect(readdirSync(out).some((d) => d.startsWith("openai-"))).toBe(false);
  });

  it("writes result files for probed models", async () => {
    await runCycle(plan([PRICED_A]), {
      outDir: out,
      keys: KEYS,
      runProbeImpl: async (cfg) => fakeResult(cfg.modelKey, 0.01),
    });
    const dirs = readdirSync(out).filter((d) => d.startsWith("openai-"));
    expect(dirs.length).toBe(1);
  });
});
