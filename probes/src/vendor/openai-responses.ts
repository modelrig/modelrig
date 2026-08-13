/**
 * OpenAI Responses-API caller (coverage follow-ups 2026-08-11). The GPT-5-*-pro
 * models are Responses-API only — v1/chat/completions returns "This is not a
 * chat model" — so the chat-completions caller (openai.ts) cannot probe them.
 * This caller drives v1/responses and maps it onto the same ProbeCallResult
 * contract, so the harness scores a Pro model exactly like any other.
 *
 * Adapter policy (standing ruling): provider-default reasoning — NO
 * reasoning-effort override is ever sent. Reasoning tokens are billed as output
 * and are already included in usage.output_tokens (verified in the pre-flight),
 * so tokensOut carries them without double-counting.
 *
 * Shape verified against gpt-5.5-pro 2026-08-11:
 *   structured output → text.format {type:json_schema, name, strict, schema}
 *   usage             → {input_tokens, output_tokens (incl reasoning),
 *                        output_tokens_details.reasoning_tokens,
 *                        input_tokens_details.cached_tokens}
 *   text              → output[] item {type:"message"}.content[] {type:"output_text"}.text
 */

import OpenAI from "openai";
import { classifyOpenAICompatibleMessage } from "./classify";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller } from "./types";

const DEFAULT_MAX_OUTPUT_TOKENS = 32_000;

/** Loose view of the v1/responses payload — the SDK's generated types churn, so
 * we read the handful of fields we verified rather than bind to them. */
interface ResponsesUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly input_tokens_details?: { readonly cached_tokens?: number };
}
interface ResponsesOutputContent {
  readonly type?: string;
  readonly text?: string;
  readonly refusal?: string;
}
interface ResponsesOutputItem {
  readonly type?: string;
  readonly content?: readonly ResponsesOutputContent[];
}
interface ResponsesBody {
  readonly status?: string;
  readonly incomplete_details?: { readonly reason?: string } | null;
  readonly usage?: ResponsesUsage;
  readonly output?: readonly ResponsesOutputItem[];
  readonly output_text?: string;
}

/** First output_text across the message items (reasoning items carry no text). */
export function extractResponsesText(body: ResponsesBody): { text: string; refusal: string | null } {
  if (typeof body.output_text === "string" && body.output_text.length > 0) {
    return { text: body.output_text, refusal: null };
  }
  for (const item of body.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "refusal" && typeof c.refusal === "string" && c.refusal.length > 0) {
        return { text: "", refusal: c.refusal };
      }
      if (c.type === "output_text" && typeof c.text === "string") {
        return { text: c.text, refusal: null };
      }
    }
  }
  return { text: "", refusal: null };
}

/** Map v1/responses usage → the probe's ProbeUsage. reasoning tokens are
 * already inside output_tokens (verified), so tokensOut is not adjusted. */
export function mapResponsesUsage(usage: ResponsesUsage | undefined): {
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
} {
  return {
    tokensIn: usage?.input_tokens ?? 0,
    tokensOut: usage?.output_tokens ?? 0,
    tokensCached: usage?.input_tokens_details?.cached_tokens ?? 0,
  };
}

export function createOpenAIResponsesCaller(model: string, apiKey: string): ProbeCaller {
  return {
    provider: "openai",
    model,
    supports: (capability) => capability === "structured_native",

    async call(req: ProbeCallRequest): Promise<ProbeCallResult> {
      try {
        const client = new OpenAI({ apiKey, timeout: req.timeoutMs });
        const schema = req.outputSchema;
        const response = (await client.responses.create({
          model,
          max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
          input: [
            ...(req.systemPrompt !== ""
              ? [{ role: "system" as const, content: req.systemPrompt }]
              : []),
            { role: "user" as const, content: req.userPrompt },
          ],
          ...(schema !== null
            ? {
                text: {
                  format: {
                    type: "json_schema" as const,
                    name: "modelrig_probe_output",
                    strict: true,
                    schema: schema as Record<string, unknown>,
                  },
                },
              }
            : {}),
          // NO reasoning override — provider-default effort (standing policy).
        } as Parameters<typeof client.responses.create>[0])) as unknown as ResponsesBody;

        const usage = mapResponsesUsage(response.usage);
        const { text, refusal } = extractResponsesText(response);

        if (refusal !== null) {
          return { ok: false, failureClass: "refusal", message: `OpenAI refused: ${refusal.slice(0, 200)}` };
        }
        if (response.status === "incomplete") {
          const reason = response.incomplete_details?.reason ?? "unknown";
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `OpenAI responses incomplete (reason=${reason}) — likely reasoning consumed max_output_tokens`,
          };
        }
        if (text.trim().length === 0) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `empty response from OpenAI responses (status=${response.status ?? "none"})`,
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
