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
