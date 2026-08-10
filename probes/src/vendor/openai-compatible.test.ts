import { describe, expect, it } from "vitest";
import { shapeFireworksModelId, stripReasoning } from "./openai-compatible";

describe("shapeFireworksModelId", () => {
  it("wraps a short id in the accounts/fireworks/models path", () => {
    expect(shapeFireworksModelId("glm-5p2")).toBe("accounts/fireworks/models/glm-5p2");
  });
  it("leaves an already-qualified id untouched", () => {
    expect(shapeFireworksModelId("accounts/fireworks/models/x")).toBe("accounts/fireworks/models/x");
  });
});

describe("stripReasoning", () => {
  it("removes a closed think block and keeps the JSON answer", () => {
    expect(stripReasoning('<think>let me reason</think>\n{"a":1}')).toBe('{"a":1}');
  });
  it("removes multiple think blocks", () => {
    expect(stripReasoning('<think>a</think>{"x":1}<think>b</think>')).toBe('{"x":1}');
  });
  it("leaves an unclosed think block (honest parse failure)", () => {
    const t = "<think>ran out of tokens mid-thought";
    expect(stripReasoning(t)).toBe(t);
  });
  it("is a no-op for plain JSON", () => {
    expect(stripReasoning('{"a":1}')).toBe('{"a":1}');
  });
});
