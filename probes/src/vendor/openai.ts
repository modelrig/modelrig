/**
 * Thin direct OpenAI caller — post-C2 patch P2. Transformation logic vendored
 * from ModelRig's openai adapter: response_format json_schema strict for the
 * native rung, refusal detection, cached-token accounting. Non-streaming on
 * purpose — probe outputs are small and a single response carries usage.
 * Non-goals kept out: service tiers, prompt-cache directives, retries.
 *
 * Portions may be derived from LiteLLM (https://github.com/BerriAI/litellm),
 * Copyright (c) 2023 Berri AI, MIT License.
 */

import OpenAI from "openai";
import { classifyOpenAICompatibleMessage } from "./classify";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller } from "./types";

const DEFAULT_MAX_COMPLETION_TOKENS = 32_000;

export function createOpenAICaller(model: string, apiKey: string): ProbeCaller {
  return {
    provider: "openai",
    model,
    supports: (capability) => capability === "structured_native",

    async call(req: ProbeCallRequest): Promise<ProbeCallResult> {
      try {
        const client = new OpenAI({ apiKey, timeout: req.timeoutMs });
        const response = await client.chat.completions.create({
          model,
          max_completion_tokens: DEFAULT_MAX_COMPLETION_TOKENS,
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
                    name: "modelrig_probe_output",
                    schema: req.outputSchema as Record<string, unknown>,
                    strict: true,
                  },
                },
              }
            : {}),
        });

        const choice = response.choices[0];
        const usageRaw = response.usage;
        const usage = {
          tokensIn: usageRaw?.prompt_tokens ?? 0,
          tokensOut: usageRaw?.completion_tokens ?? 0,
          tokensCached: usageRaw?.prompt_tokens_details?.cached_tokens ?? 0,
        };

        const refusal = choice?.message?.refusal;
        if (typeof refusal === "string" && refusal.length > 0) {
          return {
            ok: false,
            failureClass: "refusal",
            message: `OpenAI refused structured output: ${refusal.slice(0, 200)}`,
          };
        }

        const text = choice?.message?.content ?? "";
        if (text.trim().length === 0) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `empty response from OpenAI (finish_reason=${choice?.finish_reason ?? "none"})`,
          };
        }
        if (choice?.finish_reason === "length" && req.outputSchema !== null) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: "OpenAI structured output truncated (finish_reason=length)",
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
