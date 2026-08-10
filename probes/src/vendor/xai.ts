/**
 * Thin direct xAI (Grok) caller — provider expansion 2026-08-02.
 * OpenAI-compatible API at api.x.ai/v1 with native strict json_schema
 * structured outputs; automatic prompt caching surfaces cached tokens in
 * prompt_tokens_details. Reasoning models keep their trace server-side —
 * message.content only. Non-streaming (probe prompts are small).
 *
 * Portions may be derived from LiteLLM (https://github.com/BerriAI/litellm),
 * Copyright (c) 2023 Berri AI, MIT License.
 */

import OpenAI from "openai";
import { classifyOpenAICompatibleMessage } from "./classify";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller } from "./types";

const XAI_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_MAX_TOKENS = 16_000;

export function createXaiCaller(model: string, apiKey: string): ProbeCaller {
  return {
    provider: "grok",
    model,
    supports: (capability) => capability === "structured_native",

    async call(req: ProbeCallRequest): Promise<ProbeCallResult> {
      try {
        const client = new OpenAI({ apiKey, baseURL: XAI_BASE_URL, timeout: req.timeoutMs });
        const response = await client.chat.completions.create({
          model,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages: [
            ...(req.systemPrompt !== ""
              ? [{ role: "system" as const, content: req.systemPrompt }]
              : []),
            { role: "user" as const, content: req.userPrompt },
          ],
          ...(req.outputSchema !== null
            ? {
                response_format: {
                  type: "json_schema" as const,
                  json_schema: {
                    name: "probe_output",
                    schema: req.outputSchema as Record<string, unknown>,
                    strict: true,
                  },
                },
              }
            : {}),
        });

        const choice = response.choices[0];
        const usageRaw = response.usage as
          | {
              prompt_tokens?: number;
              completion_tokens?: number;
              prompt_tokens_details?: { cached_tokens?: number };
            }
          | undefined;
        const usage = {
          tokensIn: usageRaw?.prompt_tokens ?? 0,
          tokensOut: usageRaw?.completion_tokens ?? 0,
          tokensCached: usageRaw?.prompt_tokens_details?.cached_tokens ?? 0,
        };

        // message.content only — reasoning traces never enter the buffer.
        const text = choice?.message?.content ?? "";
        if (text.trim().length === 0) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `empty response from Grok (finish_reason=${choice?.finish_reason ?? "none"})`,
          };
        }
        if (choice?.finish_reason === "length" && req.outputSchema !== null) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: "Grok structured output truncated (finish_reason=length)",
          };
        }
        return { ok: true, text, usage };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, failureClass: classifyOpenAICompatibleMessage(message), message };
      }
    },
  };
}
