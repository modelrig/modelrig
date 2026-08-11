/**
 * Thin direct Gemini caller — post-C2 patch P2. Transformation logic vendored
 * from ModelRig's gemini adapter (itself ported from production):
 * responseJsonSchema for native structured output, googleSearch tool for
 * grounding, thinking tokens counted as output. Non-goals kept out on
 * purpose: tiers, caches, retries — probes measure one bare call.
 *
 * Adapter policy (architect ruling, 2026-08-10): probes call every model at
 * provider-default reasoning/effort config — no thinkingConfig is sent, ever.
 * (Probe cycles 001–002 pinned thinkingLevel "high" on thinking-capable
 * models; that pin is retired — see the gemini callNotes in the registry.)
 * Each remaining deviation from provider defaults is a named constant with
 * its reason below.
 *
 * Portions may be derived from LiteLLM (https://github.com/BerriAI/litellm),
 * Copyright (c) 2023 Berri AI, MIT License.
 */

import { GoogleGenAI } from "@google/genai";
import { classifyGeminiMessage } from "./classify";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller } from "./types";

/** REQUIRED deviation: lower values cause output looping on Gemini 3 models
 * (the probe cannot complete without it) — recorded in the gemini callNotes. */
const GEMINI_TEMPERATURE = 1.0;
/** Generous cap so structured output (and any provider-default thinking,
 * billed against this limit) is never truncated by the harness. */
const DEFAULT_MAX_OUTPUT_TOKENS = 64_000;
/** Sampling caps vendored from the production adapter, pinned identically for
 * every model and cycle so results stay comparable across harness versions. */
const TOP_P = 0.95;
const TOP_K = 40;

/**
 * Pure per-model request config — everything except the abort signal (wired
 * at call time). Exported so the per-model call config is unit-testable.
 */
export function buildGeminiProbeConfig(
  model: string,
  req: ProbeCallRequest
): Record<string, unknown> {
  void model; // policy: no per-model config branches — provider defaults for all
  const config: Record<string, unknown> = {
    temperature: GEMINI_TEMPERATURE,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    topP: TOP_P,
    topK: TOP_K,
  };
  if (req.outputSchema !== null) {
    config.responseMimeType = "application/json";
    config.responseJsonSchema = req.outputSchema;
  }
  if (req.systemPrompt !== "") config.systemInstruction = req.systemPrompt;
  if (req.grounding === true) config.tools = [{ googleSearch: {} }];
  return config;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

export function createGeminiCaller(model: string, apiKey: string): ProbeCaller {
  const ai = new GoogleGenAI({ apiKey });

  return {
    provider: "gemini",
    model,
    supports: (capability) =>
      capability === "structured_native" || capability === "grounded_native",

    async call(req: ProbeCallRequest): Promise<ProbeCallResult> {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), req.timeoutMs);
      try {
        const config: Record<string, unknown> = {
          ...buildGeminiProbeConfig(model, req),
          abortSignal: abortController.signal,
        };

        const response = await ai.models.generateContent({
          model,
          contents: req.userPrompt,
          config,
        });

        const usageMetadata = (response.usageMetadata ?? {}) as GeminiUsageMetadata;
        const usage = {
          tokensIn: usageMetadata.promptTokenCount ?? 0,
          // Thinking tokens are billed as output — honest accounting.
          tokensOut:
            (usageMetadata.candidatesTokenCount ?? 0) + (usageMetadata.thoughtsTokenCount ?? 0),
          tokensCached: usageMetadata.cachedContentTokenCount ?? 0,
        };

        const candidates = (response as unknown as { candidates?: Array<{ finishReason?: string }> })
          .candidates;
        const finishReason = candidates?.[0]?.finishReason;
        if (
          finishReason === "SAFETY" ||
          finishReason === "PROHIBITED_CONTENT" ||
          finishReason === "RECITATION"
        ) {
          return {
            ok: false,
            failureClass: "refusal",
            message: `Gemini blocked output (finishReason=${finishReason})`,
          };
        }

        const text = response.text ?? "";
        if (text.trim().length === 0) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `empty response from Gemini (finishReason=${finishReason ?? "none"})`,
          };
        }
        if (finishReason === "MAX_TOKENS" && req.outputSchema !== null) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: "Gemini structured output truncated (finishReason=MAX_TOKENS)",
          };
        }
        return { ok: true, text, usage };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (abortController.signal.aborted) {
          return {
            ok: false,
            failureClass: "timeout",
            message: `Gemini call exceeded timeoutMs=${req.timeoutMs}: ${message}`,
          };
        }
        return { ok: false, failureClass: classifyGeminiMessage(message), message };
      } finally {
        clearTimeout(timeoutId);
      }
    },
  };
}
