/**
 * Model-key resolution: "provider/model" → a vendored direct-API ProbeCaller.
 * Post-C2 patch P2: the probe runner is fully self-contained — no modelrig
 * dependency — so `run` reproduces externally with nothing but this repo and
 * your own API keys.
 */

import type { ProbesConfig } from "./config";
import { createAnthropicCaller } from "./vendor/anthropic";
import { createDeepSeekCaller } from "./vendor/deepseek";
import { createGeminiCaller } from "./vendor/gemini";
import { createOpenAICaller } from "./vendor/openai";
import { createOpenAICompatibleCaller, OPENAI_COMPAT_HOSTS } from "./vendor/openai-compatible";
import { createOpenAIResponsesCaller } from "./vendor/openai-responses";
import { createXaiCaller } from "./vendor/xai";
import type { ProbeCaller, ProbeProviderId } from "./vendor/types";

/** OpenAI models that are Responses-API ONLY — v1/chat/completions returns
 * "This is not a chat model" for them. The Pro tier of the GPT-5 / o-series
 * families all ship this way (verified 2026-08-11: gpt-5.5-pro). A model that
 * does NOT match here uses chat-completions exactly as before — fail-closed to
 * the established path, so a new non-Pro model is never mis-routed. */
export function isOpenAIResponsesOnly(model: string): boolean {
  return model.endsWith("-pro");
}

const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set([
  "gemini",
  "openai",
  "deepseek",
  "anthropic",
  "grok",
  "deepinfra",
  "fireworks",
]);

export function parseModelKey(modelKey: string): { provider: ProbeProviderId; model: string } {
  const slash = modelKey.indexOf("/");
  if (slash <= 0 || slash === modelKey.length - 1) {
    throw new Error(`model key "${modelKey}" must be "provider/model" (e.g. "openai/gpt-5.2")`);
  }
  const provider = modelKey.slice(0, slash);
  const model = modelKey.slice(slash + 1);
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(
      `provider "${provider}" is not supported by the probe harness — ` +
        `known providers: [${[...SUPPORTED_PROVIDERS].join(", ")}]`
    );
  }
  return { provider: provider as ProbeProviderId, model };
}

export function resolveModel(modelKey: string, keys: ProbesConfig["keys"]): ProbeCaller {
  const { provider, model } = parseModelKey(modelKey);
  switch (provider) {
    case "gemini":
      if (!keys.gemini) throw new Error("GEMINI_API_KEY is not set");
      return createGeminiCaller(model, keys.gemini);
    case "openai":
      if (!keys.openai) throw new Error("OPENAI_API_KEY is not set");
      return isOpenAIResponsesOnly(model)
        ? createOpenAIResponsesCaller(model, keys.openai)
        : createOpenAICaller(model, keys.openai);
    case "deepseek":
      if (!keys.deepseek) throw new Error("DEEPSEEK_API_KEY is not set");
      return createDeepSeekCaller(model, keys.deepseek);
    case "anthropic":
      if (!keys.anthropic) throw new Error("ANTHROPIC_API_KEY is not set");
      return createAnthropicCaller(model, keys.anthropic);
    case "grok":
      if (!keys.grok) throw new Error("XAI_API_KEY is not set");
      return createXaiCaller(model, keys.grok);
    case "deepinfra":
      if (!keys.deepinfra) throw new Error("MODELRIG_DEEPINFRA_API_KEY is not set");
      return createOpenAICompatibleCaller(OPENAI_COMPAT_HOSTS.deepinfra, model, keys.deepinfra);
    case "fireworks":
      if (!keys.fireworks) throw new Error("MODELRIG_FIREWORKS_API_KEY is not set");
      return createOpenAICompatibleCaller(OPENAI_COMPAT_HOSTS.fireworks, model, keys.fireworks);
  }
}
