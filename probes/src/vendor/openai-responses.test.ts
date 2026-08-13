/**
 * Responses-API caller — the usage/text mapping and routing are the
 * load-bearing pure logic (the network call is a thin SDK wrapper). Shapes are
 * the ones verified live against gpt-5.5-pro 2026-08-11.
 */

import { describe, expect, it } from "vitest";
import { extractResponsesText, mapResponsesUsage } from "./openai-responses";
import { isOpenAIResponsesOnly } from "../providers";

describe("mapResponsesUsage — reasoning tokens are already inside output_tokens", () => {
  it("maps input/output/cached; does NOT double-count reasoning", () => {
    const usage = {
      input_tokens: 40,
      output_tokens: 49, // includes the 35 reasoning tokens
      output_tokens_details: { reasoning_tokens: 35 },
      input_tokens_details: { cached_tokens: 12 },
    };
    expect(mapResponsesUsage(usage)).toEqual({ tokensIn: 40, tokensOut: 49, tokensCached: 12 });
  });

  it("defaults missing usage to zeros", () => {
    expect(mapResponsesUsage(undefined)).toEqual({ tokensIn: 0, tokensOut: 0, tokensCached: 0 });
  });
});

describe("extractResponsesText — text lives in the message item, not reasoning", () => {
  it("pulls output_text from the message item, skipping the reasoning item", () => {
    const body = {
      status: "completed",
      output: [
        { type: "reasoning", content: [] },
        { type: "message", content: [{ type: "output_text", text: '{"capital":"Paris"}' }] },
      ],
    };
    expect(extractResponsesText(body)).toEqual({ text: '{"capital":"Paris"}', refusal: null });
  });

  it("surfaces a refusal distinctly from empty text", () => {
    const body = {
      status: "completed",
      output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that" }] }],
    };
    expect(extractResponsesText(body)).toEqual({ text: "", refusal: "I can't help with that" });
  });

  it("prefers a top-level output_text convenience field when present", () => {
    expect(extractResponsesText({ output_text: "hi", output: [] })).toEqual({ text: "hi", refusal: null });
  });

  it("returns empty text when no message item carries output_text", () => {
    expect(extractResponsesText({ output: [{ type: "reasoning", content: [] }] })).toEqual({
      text: "",
      refusal: null,
    });
  });
});

describe("isOpenAIResponsesOnly — routing is fail-closed to chat-completions", () => {
  it("routes the Pro tier to the Responses API", () => {
    expect(isOpenAIResponsesOnly("gpt-5.5-pro")).toBe(true);
    expect(isOpenAIResponsesOnly("gpt-5-pro")).toBe(true);
    expect(isOpenAIResponsesOnly("o1-pro")).toBe(true);
  });

  it("leaves every non-Pro model on chat-completions (fail-closed default)", () => {
    for (const m of ["gpt-5.5", "gpt-5.4", "gpt-5-mini", "gpt-5.4-nano", "gpt-5.2"]) {
      expect(isOpenAIResponsesOnly(m), m).toBe(false);
    }
  });
});
