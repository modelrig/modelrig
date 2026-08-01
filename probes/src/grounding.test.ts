/**
 * Grounding + caching class tests (hermetic, fake adapters).
 */

import { describe, expect, it } from "vitest";
import type { AdapterRequest, AdapterResult, ProviderAdapter } from "modelrig";
import { resolveCandidates } from "modelrig";
import { runCachingSample } from "./caching";
import { extractCitations, runGroundingSample } from "./grounding";
import type { SampleContext } from "./harness";
import type { ProbeFixture } from "./types";

const GROUNDING_FIXTURE: ProbeFixture = {
  id: "g1",
  class: "grounding",
  prompt: "Find X and cite sources.",
  source: "test",
};

const CACHING_FIXTURE: ProbeFixture = {
  id: "c1",
  class: "caching",
  prompt: "long fixed prefix …",
  source: "test",
};

function ctxWith(
  results: AdapterResult[],
  flags: { groundedNative?: boolean } = {}
): SampleContext & { requests: AdapterRequest[] } {
  const requests: AdapterRequest[] = [];
  let i = 0;
  const adapter: ProviderAdapter = {
    id: "gemini",
    supports: (flag) => (flag === "grounded_native" ? (flags.groundedNative ?? false) : false),
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
      candidates: [{ provider: "gemini", model: "g-model" }],
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
  if (candidate === null) throw new Error("unreachable");
  return { adapter, candidate, provider: "gemini", model: "g-model", requests };
}

function ok(text: string, cached = 0): AdapterResult {
  return {
    ok: true,
    text,
    usage: { tokensIn: 4000, tokensOut: 100, tokensCached: cached, servedTier: "standard" },
  };
}

describe("extractCitations", () => {
  it("dedupes URLs, strips trailing punctuation, and counts distinct domains", () => {
    const scan = extractCitations(
      "Per https://reuters.com/a/b, and again https://reuters.com/a/b. Also see " +
        "https://www.sec.gov/filing.html; end."
    );
    expect(scan.urls).toHaveLength(2);
    expect(scan.distinctDomains.sort()).toEqual(["reuters.com", "sec.gov"]);
  });

  it("finds nothing in citation-free prose", () => {
    const scan = extractCitations("Revenue was about 60 billion dollars last quarter.");
    expect(scan.urls).toHaveLength(0);
  });
});

describe("runGroundingSample", () => {
  it("marks grounded with citation count when URLs are present", async () => {
    const ctx = ctxWith([ok("Answer. Sources: https://a.com/x https://b.org/y")], {
      groundedNative: true,
    });
    const sample = await runGroundingSample(ctx, GROUNDING_FIXTURE);
    expect(ctx.requests[0].grounding).toBe(true);
    expect(sample.grounded).toBe(true);
    expect(sample.citationCount).toBe(2);
  });

  it("marks ungrounded when the model answers without citations", async () => {
    const ctx = ctxWith([ok("I believe the answer is 42 but cannot search.")]);
    const sample = await runGroundingSample(ctx, GROUNDING_FIXTURE);
    expect(ctx.requests[0].grounding).toBeUndefined(); // no native grounding flag
    expect(sample.grounded).toBe(false);
    expect(sample.citationCount).toBe(0);
  });
});

describe("runCachingSample", () => {
  it("pairs calls and records the repeat call's cached tokens; cost covers both", async () => {
    const ctx = ctxWith([ok("first", 0), ok("second", 3800)]);
    const sample = await runCachingSample(ctx, CACHING_FIXTURE);
    expect(ctx.requests).toHaveLength(2);
    expect(ctx.requests[0].systemPrompt).toBe(ctx.requests[1].systemPrompt);
    expect(sample.cachedTokens).toBe(3800);
    expect(sample.parseOk).toBe(true);
    expect(sample.costUsd).toBe(0); // unknown model in pricing map → 0 (test model)
  });

  it("records a failure class when the prime call fails", async () => {
    const ctx = ctxWith([{ ok: false, failure: { class: "network", message: "boom" } }]);
    const sample = await runCachingSample(ctx, CACHING_FIXTURE);
    expect(sample.failureClass).toBe("network");
    expect(sample.cachedTokens).toBeNull();
    expect(ctx.requests).toHaveLength(1); // no repeat after a failed prime
  });
});
