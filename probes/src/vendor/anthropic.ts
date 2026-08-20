/**
 * Thin direct Anthropic caller — provider expansion 2026-08-02.
 * Messages API over raw fetch (keeps the probe runner dependency-light —
 * no SDK). Structured output is a FORCED TOOL CALL: the probe schema
 * becomes the single tool's input_schema, tool_choice pins it, and the
 * tool_use block's input is the JSON output. Non-streaming (probe prompts
 * are small and max_tokens stays well under the streaming-required bound).
 */

import { classifyOpenAICompatibleMessage } from "./classify";
import type { ProbeCallRequest, ProbeCallResult, ProbeCaller } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const STRUCTURED_OUTPUTS_BETA = "structured-outputs-2025-11-13";
const DEFAULT_MAX_TOKENS = 8_192;
const OUTPUT_TOOL_NAME = "probe_output";

/** Strict-mode 400: the schema exceeds Anthropic's constrained-decoding
 * compile limits, so we downgrade to advisory (json_mode) — the same
 * downgrade the gateway adapter makes and does NOT surface as a failure.
 * Two rejection families: (1) compile-blowup on union-typed params, and
 * (2) unsupported JSON Schema keywords/constraints under strict — e.g.
 * `minItems` values other than 0 or 1, and the min/max size keywords. The
 * detection MUST cover both or a flagship gets failed where the product would
 * have succeeded (probe-fidelity bug found in cycle 001). */
export function isStrictSchemaRejection(message: string): boolean {
  return /union|exponential compilation|does not support strict|strict.*not supported|values other than 0 or 1|'(min|max)(items|length|imum|properties)'|\b(min|max)(Items|Length|imum|Properties)\b/i.test(
    message
  );
}

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
    name?: string;
    input?: unknown;
  }>;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
  error?: { type?: string; message?: string };
}

export function createAnthropicCaller(model: string, apiKey: string): ProbeCaller {
  return {
    provider: "anthropic",
    model,
    supports: (capability) => capability === "structured_native",

    async call(req: ProbeCallRequest): Promise<ProbeCallResult> {
      try {
        const wantJson = req.outputSchema !== null;
        const doFetch = async (strict: boolean): Promise<Response> => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), req.timeoutMs);
          try {
            return await fetch(ANTHROPIC_URL, {
              method: "POST",
              signal: controller.signal,
              headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": ANTHROPIC_VERSION,
                ...(strict ? { "anthropic-beta": STRUCTURED_OUTPUTS_BETA } : {}),
              },
              body: JSON.stringify({
                model,
                max_tokens: DEFAULT_MAX_TOKENS,
                // Anthropic prompt caching is explicit opt-in: the caching
                // probe (cacheHint) marks the fixed system prefix with a
                // cache_control breakpoint so the probe measures the
                // DOCUMENTED path, not the default one (launch-runbook A1).
                ...(req.systemPrompt !== ""
                  ? {
                      system: req.cacheHint
                        ? [
                            {
                              type: "text",
                              text: req.systemPrompt,
                              cache_control: { type: "ephemeral" },
                            },
                          ]
                        : req.systemPrompt,
                    }
                  : {}),
                messages: [{ role: "user", content: req.userPrompt }],
                ...(wantJson
                  ? {
                      tools: [
                        {
                          name: OUTPUT_TOOL_NAME,
                          description: "Emit the structured probe output.",
                          input_schema: req.outputSchema,
                          ...(strict ? { strict: true } : {}),
                        },
                      ],
                      tool_choice: { type: "tool", name: OUTPUT_TOOL_NAME },
                    }
                  : {}),
              }),
            });
          } finally {
            clearTimeout(timer);
          }
        };

        // Strict-first (constrained decoding); advisory fallback when the
        // schema exceeds Anthropic's strict-mode compile limits.
        let response = await doFetch(wantJson);
        let body = (await response.json().catch(() => ({}))) as AnthropicResponse;
        if (
          wantJson &&
          response.status === 400 &&
          isStrictSchemaRejection(body.error?.message ?? "")
        ) {
          response = await doFetch(false);
          body = (await response.json().catch(() => ({}))) as AnthropicResponse;
        }
        if (!response.ok) {
          const message = `${response.status} ${body.error?.type ?? ""}: ${body.error?.message ?? "request failed"}`;
          return { ok: false, failureClass: classifyOpenAICompatibleMessage(message), message };
        }

        const usage = {
          tokensIn: body.usage?.input_tokens ?? 0,
          tokensOut: body.usage?.output_tokens ?? 0,
          tokensCached: body.usage?.cache_read_input_tokens ?? 0,
        };

        // Schema path: the forced tool_use block's input IS the output.
        // Plain path: concatenated text blocks.
        const text = wantJson
          ? JSON.stringify(
              body.content?.find((b) => b.type === "tool_use" && b.name === OUTPUT_TOOL_NAME)
                ?.input ?? null
            )
          : (body.content ?? [])
              .filter((b) => b.type === "text")
              .map((b) => b.text ?? "")
              .join("");

        if (text.trim().length === 0 || text === "null") {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: `empty response from Anthropic (stop_reason=${body.stop_reason ?? "none"})`,
          };
        }
        if (body.stop_reason === "max_tokens" && wantJson) {
          return {
            ok: false,
            failureClass: "content_invalid",
            message: "Anthropic structured output truncated (stop_reason=max_tokens)",
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
