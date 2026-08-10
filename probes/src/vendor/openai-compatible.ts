/**
 * Generic OpenAI-compatible caller — the probe-harness twin of ModelRig's
 * src/adapters/openai-compat.ts (provider-coverage-plan §1: "the DeepSeek
 * adapter is its parameterization"). One caller covers every OpenAI-dialect
 * host; base URL, auth key, model-id shaping, and provider id are INJECTED.
 *
 * Vendored, self-contained (post-C2 patch P2): no modelrig dependency, so the
 * probe suite reproduces externally with this repo + a host key. Non-streaming
 * on purpose — probe outputs are small and one response carries usage.
 *
 * Capability posture (the doctrine part): the conservative dialect baseline is
 * json_mode alone. `supports()` returns false — exactly like the DeepSeek
 * vendor — so schema fixtures run through the coached json_object rung, and
 * "does this host actually enforce a schema" stays a probed fact rather than a
 * dialect assumption. Native strict enforcement, when it exists, is a per-model
 * registry fact established later, never claimed here.
 *
 * Host wire facts (from LiteLLM's per-provider transforms, harvested):
 *   deepinfra  base https://api.deepinfra.com/v1/openai (standard Bearer)
 *   fireworks  base https://api.fireworks.ai/inference/v1, model ids on the
 *              wire as accounts/fireworks/models/<short>
 *
 * Portions may be derived from LiteLLM (https://github.com/BerriAI/litellm),
 * Copyright (c) 2023 Berri AI, MIT License.
 */

import OpenAI from "openai";
import { classifyOpenAICompatibleMessage } from "./classify";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller, ProbeProviderId } from "./types";

const DEFAULT_MAX_TOKENS = 32_000;

/** json_object mode 400s on several compat backends when the literal word
 * "JSON" appears nowhere in the prompt (the DeepSeek-family quirk; coached
 * prompts normally guarantee it — this is belt-and-suspenders). */
const JSON_GUARD = "Respond with a single valid JSON object.";

/** Hybrid reasoners on compat hosts (Qwen3, GLM, …) intermittently inline a
 * `<think>…</think>` chain-of-thought before the answer, in message.content
 * rather than a separate reasoning_content field. The answer buffer must never
 * carry chain-of-thought — the same rule the DeepSeek vendor keeps — so closed
 * think blocks are removed before parsing. An UNCLOSED think block (the model
 * ran out mid-reasoning) is left as-is and fails to parse honestly, exactly as
 * a customer would see it. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export interface OpenAICompatHost {
  readonly providerId: ProbeProviderId;
  readonly baseUrl: string;
  /** Wire-shape the model id (Fireworks needs accounts/fireworks/models/…). */
  readonly shapeModelId?: (model: string) => string;
}

/** Fireworks serves at accounts/fireworks/models/<short>; routes carry the
 * short name, the wire gets the full path (LiteLLM fireworks_ai transform). */
export function shapeFireworksModelId(model: string): string {
  return model.startsWith("accounts/") ? model : `accounts/fireworks/models/${model}`;
}

/** The researched Tier-2 hosts (provider-coverage-plan §2, architect pick
 * 2026-08-02): DeepInfra + Fireworks. Same weights on both on purpose — the
 * host-level conformance/latency/price deltas become registry facts. */
export const OPENAI_COMPAT_HOSTS: Readonly<Record<"deepinfra" | "fireworks", OpenAICompatHost>> = {
  deepinfra: { providerId: "deepinfra", baseUrl: "https://api.deepinfra.com/v1/openai" },
  fireworks: {
    providerId: "fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    shapeModelId: shapeFireworksModelId,
  },
};

export function createOpenAICompatibleCaller(
  host: OpenAICompatHost,
  model: string,
  apiKey: string
): ProbeCaller {
  const wireModel = host.shapeModelId ? host.shapeModelId(model) : model;
  return {
    provider: host.providerId,
    model,
    // Conservative dialect baseline: neither structured_native nor
    // grounded_native. Schema fixtures take the coached json_object rung.
    supports: () => false,

    async call(req: ProbeCallRequest): Promise<ProbeCallResult> {
      try {
        const wantJson = req.outputSchema !== null;
        let systemPrompt = req.systemPrompt;
        if (wantJson && !systemPrompt.includes("JSON") && !req.userPrompt.includes("JSON")) {
          systemPrompt = systemPrompt === "" ? JSON_GUARD : `${systemPrompt}\n\n${JSON_GUARD}`;
        }

        const client = new OpenAI({ apiKey, baseURL: host.baseUrl, timeout: req.timeoutMs });
        const response = await client.chat.completions.create({
          model: wireModel,
          max_tokens: DEFAULT_MAX_TOKENS,
          messages: [
            ...(systemPrompt !== "" ? [{ role: "system" as const, content: systemPrompt }] : []),
            { role: "user" as const, content: req.userPrompt },
          ],
          ...(wantJson ? { response_format: { type: "json_object" as const } } : {}),
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

        // message.content only, with inline chain-of-thought stripped — a
        // reasoner's reasoning must never leak into the answer buffer.
        const text = stripReasoning(choice?.message?.content ?? "");
        if (text.trim().length === 0) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `empty response from ${host.providerId} (finish_reason=${choice?.finish_reason ?? "none"})`,
          };
        }
        if (choice?.finish_reason === "length" && req.outputSchema !== null) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `${host.providerId} JSON output truncated (finish_reason=length)`,
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
