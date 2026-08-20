import { describe, expect, it } from "vitest";
import { isStrictSchemaRejection } from "./anthropic";

describe("isStrictSchemaRejection — strict→advisory downgrade trigger", () => {
  it("fires on the minItems constraint rejection (cycle-001 fidelity bug)", () => {
    expect(
      isStrictSchemaRejection(
        "tools.0.custom: For 'array' type, 'minItems' values other than 0 or 1 are not supported (got: [2, 5])"
      )
    ).toBe(true);
  });
  it("still fires on the original union/compile-limit family", () => {
    expect(isStrictSchemaRejection("exponential compilation blowup on union types")).toBe(true);
    expect(isStrictSchemaRejection("this schema does not support strict decoding")).toBe(true);
  });
  it("fires on other size-keyword rejections (maxItems, minLength)", () => {
    expect(isStrictSchemaRejection("'maxItems' is not supported under strict")).toBe(true);
    expect(isStrictSchemaRejection("'minLength' values other than 0 or 1 are not supported")).toBe(true);
  });
  it("does NOT fire on unrelated 400s (a genuinely bad request stays a failure)", () => {
    expect(isStrictSchemaRejection("invalid api key")).toBe(false);
    expect(isStrictSchemaRejection("model not found")).toBe(false);
  });
});

describe("createAnthropicCaller — cacheHint marks the documented opt-in path", () => {
  it("sends the system prefix as a cache_control block when cacheHint is set, plain otherwise", async () => {
    const { createAnthropicCaller } = await import("./anthropic");
    const bodies: Record<string, unknown>[] = [];
    const stub = async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 3000, output_tokens: 5, cache_read_input_tokens: 0 },
        }),
        { status: 200 }
      );
    };
    const original = globalThis.fetch;
    globalThis.fetch = stub as unknown as typeof fetch;
    try {
      const caller = createAnthropicCaller("test-model", "sk-test");
      const base = { systemPrompt: "PREFIX", userPrompt: "go", outputSchema: null, timeoutMs: 5000 };
      await caller.call({ ...base, cacheHint: true });
      await caller.call(base);
    } finally {
      globalThis.fetch = original;
    }
    expect(bodies[0].system).toEqual([
      { type: "text", text: "PREFIX", cache_control: { type: "ephemeral" } },
    ]);
    expect(bodies[1].system).toBe("PREFIX");
  });
});
