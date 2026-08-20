import { describe, expect, it, vi } from "vitest";
import {
  CACHE_INELIGIBLE_FAILURE,
  DEFAULT_MIN_CACHEABLE_TOKENS,
  MIN_CACHEABLE_TOKENS,
  minCacheableTokens,
  runCachingSample,
} from "./caching";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller } from "./vendor/types";
import type { ProbeFixture } from "./types";

/**
 * Documented-path caching probe (launch-runbook A1): the probe must (a) mark
 * the prefix cacheable via cacheHint on BOTH calls so opt-in providers get
 * their marker, and (b) refuse to measure — typed skip, no repeat spend —
 * when the prime call reports a prefix under the provider's documented
 * minimum. A zero on a too-short prefix is expected behavior; counting it
 * as a miss fabricates a discrepancy.
 */

const FIXTURE = { id: "fx", prompt: "long fixed prefix", expected: null } as unknown as ProbeFixture;

function okResult(tokensIn: number, tokensCached = 0): ProbeCallResult {
  return {
    ok: true,
    text: "answer",
    usage: { tokensIn, tokensOut: 10, tokensCached },
    rung: null,
  } as unknown as ProbeCallResult;
}

function fakeCaller(provider: string, results: readonly ProbeCallResult[]): {
  caller: ProbeCaller;
  calls: ProbeCallRequest[];
} {
  const calls: ProbeCallRequest[] = [];
  const queue = [...results];
  const caller = {
    provider,
    model: "test-model",
    supports: () => false,
    call: vi.fn(async (req: ProbeCallRequest) => {
      calls.push(req);
      return queue.shift() ?? okResult(9999);
    }),
  } as unknown as ProbeCaller;
  return { caller, calls };
}

describe("minCacheableTokens", () => {
  it("uses the documented per-provider bound, defaulting conservatively", () => {
    expect(minCacheableTokens("anthropic")).toBe(MIN_CACHEABLE_TOKENS.anthropic);
    expect(minCacheableTokens("deepseek")).toBe(64);
    expect(minCacheableTokens("some-new-provider")).toBe(DEFAULT_MIN_CACHEABLE_TOKENS);
  });
});

describe("runCachingSample — documented-path measurement", () => {
  it("sets cacheHint on both calls and reports the repeat call's cached tokens", async () => {
    const { caller, calls } = fakeCaller("anthropic", [okResult(4000), okResult(4000, 3900)]);
    const sample = await runCachingSample({ caller }, FIXTURE);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.cacheHint === true)).toBe(true);
    expect(sample.parseOk).toBe(true);
    expect(sample.cachedTokens).toBe(3900);
    expect(sample.failureClass).toBeNull();
  });

  it("typed-skips below the provider minimum without spending the repeat call", async () => {
    const { caller, calls } = fakeCaller("anthropic", [okResult(500)]);
    const sample = await runCachingSample({ caller }, FIXTURE);
    expect(calls).toHaveLength(1); // no second call
    expect(sample.parseOk).toBe(false);
    expect(sample.failureClass).toBe(CACHE_INELIGIBLE_FAILURE);
    expect(sample.cachedTokens).toBeNull();
  });

  it("a prefix at exactly the minimum is eligible", async () => {
    const { caller, calls } = fakeCaller("deepseek", [okResult(64), okResult(64, 64)]);
    const sample = await runCachingSample({ caller }, FIXTURE);
    expect(calls).toHaveLength(2);
    expect(sample.failureClass).toBeNull();
  });
});
