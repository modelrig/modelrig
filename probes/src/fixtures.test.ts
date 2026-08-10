/**
 * Fixture loading + hashing tests. The shipped fixture corpus is validated
 * here too (unique ids, parseable schemas, sane expected paths).
 */

import { describe, expect, it } from "vitest";
import { canonicalJson, fixtureHash, loadFixtures } from "./fixtures";
import type { ProbeFixture } from "./types";
import { createProbeAjv } from "./ajv";

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

  it("difficulty is metadata — tagging a difficulty must not invalidate published hashes", () => {
    const bare: ProbeFixture = { id: "x", class: "schema", domain: "general", prompt: "p", source: "s" };
    const standard: ProbeFixture = { ...bare, difficulty: "standard" };
    const hard: ProbeFixture = { ...bare, difficulty: "hard" };
    expect(fixtureHash(standard)).toBe(fixtureHash(bare));
    expect(fixtureHash(hard)).toBe(fixtureHash(bare));
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
    const ajv = createProbeAjv();
    for (const fixture of fixtures.filter((f) => f.class === "schema")) {
      expect(fixture.schema, `${fixture.id} missing schema`).toBeDefined();
      expect(() => ajv.compile(fixture.schema as object)).not.toThrow();
      expect(fixture.source).toMatch(/^(customer-zero|litellm-mined:|contributed:|demo-rig:)/);
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

  it("demo-rig §11.3b: the demo-rig family exists, is schema-class with ground truth, and is labeled", () => {
    const demoRig = fixtures.filter((f) => f.family === "demo-rig");
    // The four demo-rig tasks: example.support_summarize, invoice.extract, docs.qa, content.classify.
    expect(demoRig.length, "demo-rig family should have the four task fixtures").toBeGreaterThanOrEqual(4);
    for (const fixture of demoRig) {
      // Value accuracy is mandatory — schema validity alone never counts (§11.3b).
      expect(fixture.class, `${fixture.id} demo-rig fixture must be schema-class`).toBe("schema");
      expect(fixture.schema, `${fixture.id} missing schema`).toBeDefined();
      expect(
        fixture.expectedValues && Object.keys(fixture.expectedValues).length,
        `${fixture.id} demo-rig fixture has no ground truth (expectedValues)`
      ).toBeGreaterThanOrEqual(1);
      expect(fixture.source.startsWith("demo-rig:"), `${fixture.id} demo-rig source label`).toBe(true);
    }
  });

  it("§11.3b: family is metadata — tagging a family must not invalidate published hashes", () => {
    const bare: ProbeFixture = { id: "x", class: "schema", domain: "general", prompt: "p", source: "s" };
    const tagged: ProbeFixture = { ...bare, family: "demo-rig" };
    expect(fixtureHash(bare)).toBe(fixtureHash(tagged));
  });

  it("discriminating-fixtures §5: every hard fixture's expectedValues resolve in its schema and satisfy it", () => {
    // Ground-truth sanity: a typo'd path, or a truth that contradicts its own
    // schema (enum/pattern/type/bounds), would make value-accuracy silently
    // unscorable or always-wrong. The hardness must live in the model's
    // reliability, never in broken ground truth (§4 authoring rule).
    interface LeafSchema {
      readonly type?: string;
      readonly properties?: Record<string, LeafSchema>;
      readonly items?: LeafSchema;
    }
    function schemaAtPath(schema: LeafSchema, path: string): LeafSchema | null {
      let node: LeafSchema | undefined = schema;
      for (const seg of path.split(".")) {
        if (node === undefined) return null;
        if (/^[0-9]+$/.test(seg)) {
          node = node.items;
        } else {
          node = node.properties?.[seg];
        }
      }
      return node ?? null;
    }
    const ajv = createProbeAjv();
    const hard = fixtures.filter((f) => f.difficulty === "hard");
    // The committed hard tier is the pilot-verified discriminating set
    // (discriminating-fixtures §7 keep-rule) — currently the arithmetic-trap
    // fixtures that separate strong models. See the change log for the pilot
    // spread and the discarded (non-discriminating) candidates.
    expect(hard.length, "expected a hard-tier corpus to exist").toBeGreaterThanOrEqual(3);
    for (const fixture of hard) {
      expect(fixture.schema, `${fixture.id} hard fixture must have a schema`).toBeDefined();
      expect(
        fixture.expectedValues && Object.keys(fixture.expectedValues).length,
        `${fixture.id} hard fixture must carry authored ground truth`
      ).toBeGreaterThanOrEqual(1);
      for (const [path, expected] of Object.entries(fixture.expectedValues ?? {})) {
        const leaf = schemaAtPath(fixture.schema as LeafSchema, path);
        expect(leaf, `${fixture.id}: expectedValues path "${path}" does not resolve in the schema`).not.toBeNull();
        const validate = ajv.compile(leaf as object);
        expect(
          validate(expected),
          `${fixture.id}: ground truth ${JSON.stringify(expected)} at "${path}" violates its own leaf schema`
        ).toBe(true);
      }
    }
  });

  it("discriminating-fixtures §3: every hard fixture is labeled difficulty=hard with a family", () => {
    const hard = fixtures.filter((f) => f.difficulty === "hard");
    for (const fixture of hard) {
      expect(fixture.class, `${fixture.id} hard fixture must be schema-class`).toBe("schema");
      expect(fixture.family, `${fixture.id} hard fixture must declare a family`).toBeDefined();
    }
  });

  it("§6.4 fixture hygiene: no fixture carries an email, phone number, or ticker symbol", () => {
    // "publishable" has to stay true as the corpus grows: /samples renders these.
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    // US-style 10-digit phone or an international +NN… run — not invoice/date ids.
    const phone = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
    // Ticker as a cash-tag ($AAPL) or exchange-prefixed (NASDAQ: AAPL) — narrow
    // on purpose so currency codes (USD) and acronyms (JSON, SKU) never trip it.
    const ticker = /\$[A-Z]{1,5}\b|\b(?:NYSE|NASDAQ|NYSEARCA|AMEX|OTC)\s?:\s?[A-Z]{1,5}\b/;
    for (const fixture of fixtures) {
      const haystack = JSON.stringify(fixture);
      expect(email.test(haystack), `${fixture.id} contains an email address`).toBe(false);
      expect(phone.test(haystack), `${fixture.id} contains a phone number`).toBe(false);
      expect(ticker.test(haystack), `${fixture.id} contains a ticker symbol`).toBe(false);
    }
  });
});
