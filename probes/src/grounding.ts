/**
 * Grounding probe class — spec WS2, generalized from customer zero's
 * internal websearch/grounding QA evals (citation count + distinct domains;
 * zero citations = the failure signal): fixtures ask questions that require
 * search and demand full source URLs; the sample records whether the model
 * actually cited (citationCount as distinct citation URLs; grounded = at
 * least one real citation).
 */

import type { ProbeFixture, ProbeSample } from "./types";
import type { SampleContext } from "./harness";
import { probeSampleCostUsd } from "./vendor/pricing";

const URL_PATTERN = /https?:\/\/[^\s"'<>)\]]+/g;

export interface CitationScan {
  readonly urls: readonly string[];
  readonly distinctDomains: readonly string[];
}

export function extractCitations(text: string): CitationScan {
  const raw = text.match(URL_PATTERN) ?? [];
  const urls = [...new Set(raw.map((u) => u.replace(/[.,;:]+$/, "")))];
  const domains = new Set<string>();
  for (const url of urls) {
    try {
      domains.add(new URL(url).hostname.replace(/^www\./, ""));
    } catch {
      // unparseable pseudo-URL — counts as no domain
    }
  }
  return { urls, distinctDomains: [...domains] };
}

const USER_DIRECTIVE = "Answer now, following the instructions exactly.";

export async function runGroundingSample(
  ctx: SampleContext,
  fixture: ProbeFixture
): Promise<ProbeSample> {
  // Native grounding when the caller declares it; otherwise the plain call
  // still probes whether the model fabricates citations without search —
  // both behaviors belong in the registry.
  const nativeGrounding = ctx.caller.supports("grounded_native");

  const started = Date.now();
  const result = await ctx.caller.call({
    systemPrompt: fixture.prompt,
    userPrompt: USER_DIRECTIVE,
    outputSchema: null,
    timeoutMs: 180_000,
    ...(nativeGrounding ? { grounding: true } : {}),
  });
  const latencyMs = Date.now() - started;

  if (!result.ok) {
    return {
      parseOk: false,
      schemaConform: null,
      valueAccuracy: null,
      grounded: false,
      citationCount: 0,
      cachedTokens: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs,
      failureClass: result.failureClass,
    };
  }

  const costUsd = probeSampleCostUsd(ctx.caller.provider, ctx.caller.model, result.usage);

  const scan = extractCitations(result.text);
  return {
    parseOk: true,
    schemaConform: null,
    valueAccuracy: null,
    grounded: scan.urls.length > 0 && scan.distinctDomains.length > 0,
    citationCount: scan.urls.length,
    cachedTokens: null,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    costUsd,
    latencyMs,
    failureClass: null,
  };
}
