import { describe, expect, it } from "vitest";
import { parseModelKey, resolveModel } from "./providers";

describe("parseModelKey", () => {
  it("splits provider/model at the first slash", () => {
    expect(parseModelKey("openai/gpt-5.2")).toEqual({ provider: "openai", model: "gpt-5.2" });
    expect(parseModelKey("gemini/gemini-3.1-pro-preview")).toEqual({
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
    });
  });

  it("rejects malformed keys and unknown providers", () => {
    expect(() => parseModelKey("gpt-5.2")).toThrow(/provider\/model/);
    expect(() => parseModelKey("openai/")).toThrow(/provider\/model/);
    expect(() => parseModelKey("anthropic/claude")).toThrow(/not supported/);
  });
});

describe("resolveModel", () => {
  it("requires the provider's API key", () => {
    expect(() => resolveModel("openai/gpt-5.2", {})).toThrow(/OPENAI_API_KEY/);
  });

  it("returns a vendored caller for a keyed provider (P2: no modelrig involved)", () => {
    const caller = resolveModel("openai/gpt-5.2", { openai: "sk-test" });
    expect(caller.provider).toBe("openai");
    expect(caller.model).toBe("gpt-5.2");
    expect(caller.supports("structured_native")).toBe(true);
    expect(caller.supports("grounded_native")).toBe(false);
  });
});
