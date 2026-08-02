/**
 * Provider-error → failure-class mapping, vendored from ModelRig's adapters
 * (transformation logic only) so probe results record the same class strings
 * the gateway would. Branch ORDER is load-bearing for gemini: auth before
 * INVALID_ARGUMENT (a bad key surfaces as 400 "API key not valid"), quota
 * before generic 429 capacity.
 *
 * Portions may be derived from LiteLLM (https://github.com/BerriAI/litellm),
 * Copyright (c) 2023 Berri AI, MIT License.
 */

export function classifyGeminiMessage(message: string): string {
  const msg = message.toLowerCase();
  if (/cachedcontent|cached_content/.test(msg)) return "cache_invalid";
  if (/\b40[13]\b|api[_ ]key|permission_denied|unauthenticated/.test(msg)) return "config_auth";
  if (/quota|\brpm\b|\btpm\b|rate limit/.test(msg)) return "capacity_shed";
  if (
    /\b50[234]\b/.test(msg) ||
    /service unavailable|preempted|sheddable|overloaded|bad gateway|gateway timeout/.test(msg) ||
    /\b429\b|resource has been exhausted|serving capacity/.test(msg)
  ) {
    return "capacity_shed";
  }
  if (/abort|cancel|timeout|etimedout/.test(msg)) return "timeout";
  return "network";
}

export function classifyOpenAICompatibleMessage(message: string): string {
  const msg = message.toLowerCase();
  if (/\b429\b|rate limit|\brate\b/.test(msg)) return "capacity_shed";
  if (/\b50[023]\b|service unavailable|overloaded/.test(msg)) return "capacity_shed";
  if (/timeout|etimedout|abort/.test(msg)) return "timeout";
  if (/econnreset|econnrefused|enotfound|fetch failed|network/.test(msg)) return "network";
  if (/\b401\b|api key/.test(msg)) return "config_auth";
  return "network";
}
