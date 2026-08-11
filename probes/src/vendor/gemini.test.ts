/**
 * Per-model probe request config — the D2 adapter-policy tests (www-clarity
 * mission, 2026-08-10). Binding policy: probes call every model at
 * provider-default reasoning/effort config; every deviation is a named
 * constant with a reason and a callNotes entry.
 */
import { describe, expect, it } from "vitest";
import { buildGeminiProbeConfig } from "./gemini";
import type { ProbeCallRequest } from "./types";

function req(overrides: Partial<ProbeCallRequest> = {}): ProbeCallRequest {
  return {
    systemPrompt: "",
    userPrompt: "hello",
    outputSchema: null,
    timeoutMs: 30_000,
    ...overrides,
  };
}

const BOARD_GEMINI_MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
];

describe("buildGeminiProbeConfig (provider-default reasoning policy)", () => {
  it("sends NO thinkingConfig for any model — provider-default reasoning", () => {
    for (const model of BOARD_GEMINI_MODELS) {
      const config = buildGeminiProbeConfig(model, req());
      expect(config).not.toHaveProperty("thinkingConfig");
    }
  });

  it("pins temperature 1.0 (named required deviation: lower loops on Gemini 3)", () => {
    for (const model of BOARD_GEMINI_MODELS) {
      const config = buildGeminiProbeConfig(model, req());
      expect(config.temperature).toBe(1.0);
    }
  });

  it("keeps the generation caps identical across models (no per-model branches)", () => {
    const [a, ...rest] = BOARD_GEMINI_MODELS.map((m) => buildGeminiProbeConfig(m, req()));
    for (const other of rest) expect(other).toEqual(a);
    expect(a.maxOutputTokens).toBe(64_000);
    expect(a.topP).toBe(0.95);
    expect(a.topK).toBe(40);
  });

  it("requests native structured output only when a schema is given", () => {
    const schema = { type: "object" };
    const withSchema = buildGeminiProbeConfig("gemini-2.5-flash", req({ outputSchema: schema }));
    expect(withSchema.responseMimeType).toBe("application/json");
    expect(withSchema.responseJsonSchema).toBe(schema);
    const without = buildGeminiProbeConfig("gemini-2.5-flash", req());
    expect(without).not.toHaveProperty("responseMimeType");
    expect(without).not.toHaveProperty("responseJsonSchema");
  });

  it("sets systemInstruction only when the system prompt is non-empty", () => {
    const withSys = buildGeminiProbeConfig("gemini-2.5-flash", req({ systemPrompt: "be terse" }));
    expect(withSys.systemInstruction).toBe("be terse");
    const without = buildGeminiProbeConfig("gemini-2.5-flash", req());
    expect(without).not.toHaveProperty("systemInstruction");
  });

  it("adds the googleSearch tool only for grounded probes", () => {
    const grounded = buildGeminiProbeConfig("gemini-2.5-flash", req({ grounding: true }));
    expect(grounded.tools).toEqual([{ googleSearch: {} }]);
    const plain = buildGeminiProbeConfig("gemini-2.5-flash", req());
    expect(plain).not.toHaveProperty("tools");
  });

  it("is pure — no abort signal in the shaped config (wired at call time)", () => {
    const config = buildGeminiProbeConfig("gemini-2.5-flash", req());
    expect(config).not.toHaveProperty("abortSignal");
  });
});
