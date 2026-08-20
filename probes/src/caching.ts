/**
 * Caching probe class — spec WS2: REALIZED cache behavior on the DOCUMENTED
 * path, not declared. A sample is a paired call: prime with a long fixed
 * prefix, repeat the identical request, record the second call's reported
 * cached tokens. Per-provider regimes differ (OpenAI implicit prefix ≥1024
 * tokens, DeepSeek prefix cache, Gemini implicit caching, Anthropic
 * EXPLICIT cache_control opt-in) — the probe follows each provider's
 * documented mechanism (launch-runbook A1, 2026-08-18):
 *   · `cacheHint` is set on both calls, so opt-in providers get their
 *     cache_control marker (implicit providers ignore it);
 *   · a prime call whose prefix lands under the provider's minimum
 *     cacheable length is a TYPED SKIP (`cache_prefix_below_minimum`),
 *     never a miss — zero-on-a-too-short-prefix is documented behavior,
 *     and counting it would fabricate a discrepancy.
 */

import { probeSampleCostUsd } from "./vendor/pricing";
import type { ProbeCallResult } from "./vendor/types";
import type { ProbeFixture, ProbeSample } from "./types";
import type { SampleContext } from "./harness";

const USER_DIRECTIVE = "Answer the question at the end of the instructions now, in one short paragraph.";

/** Minimum cacheable prefix length (tokens) per provider, from provider
 * documentation at time of writing — conservative where models within a
 * provider differ (e.g. anthropic haiku-class minimums are higher than
 * sonnet/opus, so the provider gets the larger bound). Verified against the
 * prime call's REPORTED tokensIn, not an estimate. Unlisted providers get
 * DEFAULT_MIN — revisit when enrolling a provider with a documented larger
 * bound.
 *
 * CROSS-REFERENCE (cache-aware-routing WS-A): the SDK's Cache Policy Registry
 * carries a parallel `min_cacheable_tokens` per provider
 * (packages/modelrig/src/registry/cache-policy.ts) from the SAME first-party
 * pages. The two tables cannot share by import (this probes package is
 * standalone since P2). This table is a conservative PROBE-ELIGIBILITY gate
 * (deciding whether to spend a paired probe call); the registry records the
 * documented minimum for the deployed models, for accounting. Deliberate
 * deltas: anthropic 2048 here vs 1024 there (haiku-safe vs Sonnet 5/Opus 4.8);
 * gemini 2048 here vs 4096 there (spec §1.4 implicit-cache minimum) — FLAGGED
 * for the architect to converge. See cache-policy.ts
 * MIN_CACHEABLE_RECONCILIATION for the full value-by-value comparison. */
export const MIN_CACHEABLE_TOKENS: Readonly<Record<string, number>> = {
  anthropic: 2048,
  openai: 1024,
  gemini: 2048,
  deepseek: 64,
};
export const DEFAULT_MIN_CACHEABLE_TOKENS = 1024;
export const CACHE_INELIGIBLE_FAILURE = "cache_prefix_below_minimum";

export function minCacheableTokens(provider: string): number {
  return MIN_CACHEABLE_TOKENS[provider] ?? DEFAULT_MIN_CACHEABLE_TOKENS;
}

function costOf(ctx: SampleContext, result: ProbeCallResult): number {
  if (!result.ok) return 0;
  return probeSampleCostUsd(ctx.caller.provider, ctx.caller.model, result.usage);
}

export async function runCachingSample(
  ctx: SampleContext,
  fixture: ProbeFixture
): Promise<ProbeSample> {
  const request = {
    systemPrompt: fixture.prompt,
    userPrompt: USER_DIRECTIVE,
    outputSchema: null,
    timeoutMs: 180_000,
    cacheHint: true, // documented-path measurement: opt-in providers get their marker
  };

  const started = Date.now();
  const prime = await ctx.caller.call(request);
  const primeCost = costOf(ctx, prime);
  if (!prime.ok) {
    return {
      parseOk: false,
      schemaConform: null,
      valueAccuracy: null,
      grounded: null,
      citationCount: null,
      cachedTokens: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: Date.now() - started,
      failureClass: prime.failureClass,
    };
  }

  // Eligibility gate BEFORE spending the repeat call: if the fixture's
  // prefix lands under the provider's documented minimum cacheable length
  // (checked against the prime call's REPORTED input tokens), a zero on the
  // repeat would be expected behavior — typed skip, not a miss, and the
  // second call's cost is never spent.
  if (prime.usage.tokensIn < minCacheableTokens(ctx.caller.provider)) {
    return {
      parseOk: false,
      schemaConform: null,
      valueAccuracy: null,
      grounded: null,
      citationCount: null,
      cachedTokens: null,
      tokensIn: prime.usage.tokensIn,
      tokensOut: prime.usage.tokensOut,
      costUsd: primeCost,
      latencyMs: Date.now() - started,
      failureClass: CACHE_INELIGIBLE_FAILURE,
    };
  }

  const repeatStarted = Date.now();
  const repeat = await ctx.caller.call(request);
  const latencyMs = Date.now() - repeatStarted;
  if (!repeat.ok) {
    return {
      parseOk: false,
      schemaConform: null,
      valueAccuracy: null,
      grounded: null,
      citationCount: null,
      cachedTokens: null,
      tokensIn: prime.usage.tokensIn,
      tokensOut: prime.usage.tokensOut,
      costUsd: primeCost,
      latencyMs,
      failureClass: repeat.failureClass,
    };
  }

  // Sample cost covers BOTH calls (the envelope must see real spend);
  // tokens and cachedTokens report the repeat call — the measurement.
  return {
    parseOk: true,
    schemaConform: null,
    valueAccuracy: null,
    grounded: null,
    citationCount: null,
    cachedTokens: repeat.usage.tokensCached,
    tokensIn: repeat.usage.tokensIn,
    tokensOut: repeat.usage.tokensOut,
    costUsd: primeCost + costOf(ctx, repeat),
    latencyMs,
    failureClass: null,
  };
}
