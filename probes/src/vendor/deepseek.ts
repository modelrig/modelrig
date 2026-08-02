/**
 * Thin direct DeepSeek caller — post-C2 patch P2. Transformation logic
 * vendored from ModelRig's deepseek adapter: OpenAI-compatible API at
 * api.deepseek.com, json_object forcing only when a schema is passed (the
 * probe harness coaches schemas into the prompt instead — DeepSeek has no
 * native strict json_schema), the literal-"JSON" guard, reasoning_content
 * excluded from the answer buffer (message.content only). Non-streaming.
 *
 * Portions may be derived from LiteLLM (https://github.com/BerriAI/litellm),
 * Copyright (c) 2023 Berri AI, MIT License.
 */

import OpenAI from "openai";
import { classifyOpenAICompatibleMessage } from "./classify";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller } from "./types";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MAX_TOKENS = 64_000;

/** DeepSeek's json_object mode 400s when the literal word "JSON" appears
 * nowhere in the prompt (vendored belt-and-suspenders guard). */
const JSON_GUARD = "Respond with a single valid JSON object.";

export function createDeepSeekCaller(model: string, apiKey: string): ProbeCaller {
  return {
    provider: "deepseek",
    model,
    supports: () => false, // neither structured_native nor grounded_native

    async call(req: ProbeCallRequest): Promise<ProbeCallResult> {
      try {
        const wantJson = req.outputSchema !== null;
        let systemPrompt = req.systemPrompt;
        if (wantJson && !systemPrompt.includes("JSON") && !req.userPrompt.includes("JSON")) {
          systemPrompt = systemPrompt === "" ? JSON_GUARD : `${systemPrompt}\n\n${JSON_GUARD}`;
        }

        const client = new OpenAI({
          apiKey,
          baseURL: DEEPSEEK_BASE_URL,
          timeout: req.timeoutMs,
        });
        const response = await client.chat.completions.create({
          model,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages: [
            ...(systemPrompt !== "" ? [{ role: "system" as const, content: systemPrompt }] : []),
            { role: "user" as const, content: req.userPrompt },
          ],
          ...(wantJson ? { response_format: { type: "json_object" as const } } : {}),
        });

        const choice = response.choices[0];
        const usageRaw = response.usage as
          | { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number }
          | undefined;
        const usage = {
          tokensIn: usageRaw?.prompt_tokens ?? 0,
          tokensOut: usageRaw?.completion_tokens ?? 0,
          // DeepSeek's automatic prefix cache: tokens billed ~10x cheaper.
          tokensCached: usageRaw?.prompt_cache_hit_tokens ?? 0,
        };

        // message.content only — a reasoner's reasoning_content (chain of
        // thought) must never leak into the answer buffer.
        const text = choice?.message?.content ?? "";
        if (text.trim().length === 0) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `empty response from DeepSeek (finish_reason=${choice?.finish_reason ?? "none"})`,
          };
        }
        if (choice?.finish_reason === "length" && req.outputSchema !== null) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: "DeepSeek JSON output truncated (finish_reason=length)",
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
