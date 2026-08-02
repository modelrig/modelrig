/**
 * Fixture loading + hashing tests. The shipped fixture corpus is validated
 * here too (unique ids, parseable schemas, sane expected paths).
 */

import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import { canonicalJson, fixtureHash, loadFixtures } from "./fixtures";
import type { ProbeFixture } from "./types";

describe("canonicalJson / fixtureHash", () => {
  it("is key-order insensitive", () => {
    const a: ProbeFixture = { id: "x", class: "schema", domain: "general", prompt: "p", source: "s" };
    const b = JSON.parse(
      '{"source":"s","prompt":"p","domain":"general","class":"schema","id":"x"}'
    ) as ProbeFixture;
    expect(fixtureHash(a)).toBe(fixtureHash(b));
  });

  it("changes when content changes", () => {
    const a: ProbeFixture = { id: "x", class: "schema", domain: "general", prompt: "p", source: "s" };
    const b: ProbeFixture = { id: "x", class: "schema", domain: "general", prompt: "p2", source: "s" };
    expect(fixtureHash(a)).not.toBe(fixtureHash(b));
  });

  it("A2: domain is metadata — retro-tagging must not invalidate published hashes", () => {
    const finance: ProbeFixture = { id: "x", class: "schema", domain: "finance", prompt: "p", source: "s" };
    const legal: ProbeFixture = { id: "x", class: "schema", domain: "legal", prompt: "p", source: "s" };
    expect(fixtureHash(finance)).toBe(fixtureHash(legal));
  });

  it("canonicalizes nested structures deterministically", () => {
    expect(canonicalJson({ b: [1, { z: 1, a: 2 }], a: null })).toBe('{"a":null,"b":[1,{"a":2,"z":1}]}');
  });
});

describe("shipped fixture corpus", () => {
  const fixtures = loadFixtures();

  it("loads the schema-class corpus with unique ids", () => {
    const schemaFixtures = fixtures.filter((f) => f.class === "schema");
    expect(schemaFixtures.length).toBeGreaterThanOrEqual(5);
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
  });

  it("every schema fixture has a compilable JSON schema and declared provenance", () => {
    const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
    for (const fixture of fixtures.filter((f) => f.class === "schema")) {
      expect(fixture.schema, `${fixture.id} missing schema`).toBeDefined();
      expect(() => ajv.compile(fixture.schema as object)).not.toThrow();
      expect(fixture.source).toMatch(/^(customer-zero|litellm-mined:|contributed:)/);
    }
  });

  it("includes both customer-zero and litellm-mined provenance", () => {
    const sources = fixtures.map((f) => f.source);
    expect(sources.some((s) => s === "customer-zero")).toBe(true);
    expect(sources.some((s) => s.startsWith("litellm-mined:"))).toBe(true);
  });

  it("A2: every fixture carries a domain; every class has ≥1 non-finance fixture", () => {
    for (const fixture of fixtures) {
      expect(fixture.domain, `${fixture.id} missing domain`).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
    for (const cls of ["schema", "grounding", "caching"] as const) {
      const nonFinance = fixtures.filter((f) => f.class === cls && f.domain !== "finance");
      expect(nonFinance.length, `class ${cls} has no non-finance fixture`).toBeGreaterThanOrEqual(1);
    }
  });
});
