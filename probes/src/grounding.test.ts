/**
 * Grounding + caching class tests (hermetic, fake callers).
 */

import { describe, expect, it } from "vitest";
import { runCachingSample } from "./caching";
import { extractCitations, runGroundingSample } from "./grounding";
import type { SampleContext } from "./harness";
import type { ProbeFixture } from "./types";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller } from "./vendor/types";

const GROUNDING_FIXTURE: ProbeFixture = {
  id: "g1",
  class: "grounding",
  domain: "general",
  prompt: "Find X and cite sources.",
  source: "test",
};

const CACHING_FIXTURE: ProbeFixture = {
  id: "c1",
  class: "caching",
  domain: "general",
  prompt: "long fixed prefix …",
  source: "test",
};

function ctxWith(
  results: ProbeCallResult[],
  flags: { groundedNative?: boolean } = {}
): SampleContext & { requests: ProbeCallRequest[] } {
  const requests: ProbeCallRequest[] = [];
  let i = 0;
  const caller: ProbeCaller = {
    provider: "gemini",
    model: "g-model",
    supports: (capability) =>
      capability === "grounded_native" ? (flags.groundedNative ?? false) : false,
    call: async (req) => {
      requests.push(req);
      const next = results[Math.min(i, results.length - 1)];
      i += 1;
      return next;
    },
  };
  return { caller, requests };
}

function ok(text: string, cached = 0): ProbeCallResult {
  return {
    ok: true,
    text,
    usage: { tokensIn: 4000, tokensOut: 100, tokensCached: cached },
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
    const ctx = ctxWith([{ ok: false, failureClass: "network", message: "boom" }]);
    const sample = await runCachingSample(ctx, CACHING_FIXTURE);
    expect(sample.failureClass).toBe("network");
    expect(sample.cachedTokens).toBeNull();
    expect(ctx.requests).toHaveLength(1); // no repeat after a failed prime
  });
});
