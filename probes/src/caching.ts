/**
 * Caching probe class — spec WS2: REALIZED cache behavior, not declared.
 * A sample is a paired call: prime with a long fixed prefix, repeat the
 * identical request, record the second call's reported cached tokens.
 * Per-provider regimes differ (OpenAI implicit prefix ≥1024 tokens,
 * DeepSeek prefix cache, Gemini implicit caching) — the probe measures
 * what the provider actually reports, whatever the mechanism.
 */

import { estimateCostUsd, getPricing } from "modelrig";
import type { AdapterResult } from "modelrig";
import type { ProbeFixture, ProbeSample } from "./types";
import type { SampleContext } from "./harness";

const USER_DIRECTIVE = "Answer the question at the end of the instructions now, in one short paragraph.";

function costOf(ctx: SampleContext, result: AdapterResult): number {
  if (!result.ok) return 0;
  const pricing = getPricing(ctx.provider, ctx.model);
  if (pricing === null) return 0;
  return estimateCostUsd(
    pricing,
    result.usage.tokensIn,
    result.usage.tokensOut,
    result.usage.tokensCached
  );
}

export async function runCachingSample(
  ctx: SampleContext,
  fixture: ProbeFixture
): Promise<ProbeSample> {
  const request = {
    candidate: ctx.candidate,
    systemPrompt: fixture.prompt,
    userPrompt: USER_DIRECTIVE,
    outputSchema: null,
    requestedTier: "standard" as const,
    timeoutMs: 180_000,
  };

  const started = Date.now();
  const prime = await ctx.adapter.call(request);
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
      failureClass: prime.failure.class,
    };
  }

  const repeatStarted = Date.now();
  const repeat = await ctx.adapter.call(request);
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
      failureClass: repeat.failure.class,
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
