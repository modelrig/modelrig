/**
 * build-rigindex helper coverage (Cycle 4 QA follow-up) — the IO-adjacent
 * pure helpers the seven scoring families don't own: subtype bucketing +
 * merge composition in toSubtypeSamples (retired ids never resurrected),
 * schema-only grouping, the as_of derivation, and the basket loader's
 * fail-loud contract (a malformed basket must never silently anchor).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { groupByModel, loadBasket, newestDate, toSubtypeSamples } from "./build-rigindex";
import type { ProbeResultFile } from "../src/registry/build";

function resultFile(
  modelKey: string,
  date: string,
  raw: Record<string, number[]>,
  subtypes: Record<string, string> | undefined,
  cls: ProbeResultFile["class"] = "schema",
): ProbeResultFile {
  return {
    modelKey,
    class: cls,
    date,
    harnessVersion: "test",
    ...(subtypes !== undefined ? { fixtureSubtypes: subtypes } : {}),
    raw: Object.fromEntries(
      Object.entries(raw).map(([fid, accuracies]) => [
        fid,
        accuracies.map((valueAccuracy) => ({
          parseOk: true,
          schemaConform: true,
          valueAccuracy,
          grounded: null,
          citationCount: null,
          cachedTokens: null,
          costUsd: 0.001,
          failureClass: null,
        })),
      ]),
    ),
  };
}

describe("groupByModel", () => {
  it("groups schema results per model and drops other classes", () => {
    const grouped = groupByModel([
      resultFile("m/a", "2026-08-01", { f1: [1] }, undefined),
      resultFile("m/a", "2026-08-02", { f2: [1] }, undefined),
      resultFile("m/b", "2026-08-01", { f1: [0] }, undefined),
      resultFile("m/a", "2026-08-03", { g1: [1] }, undefined, "grounding"),
    ]);
    expect([...grouped.keys()].sort()).toEqual(["m/a", "m/b"]);
    expect(grouped.get("m/a")).toHaveLength(2); // grounding file excluded
  });
});

describe("newestDate", () => {
  it("returns the newest SCHEMA date across all models", () => {
    const grouped = groupByModel([
      resultFile("m/a", "2026-08-01T00:00:00.000Z", { f1: [1] }, undefined),
      resultFile("m/b", "2026-08-13T01:39:57.003Z", { f1: [1] }, undefined),
      resultFile("m/a", "2026-08-11T00:00:00.000Z", { f1: [1] }, undefined),
    ]);
    expect(newestDate(grouped)).toBe("2026-08-13T01:39:57.003Z");
  });

  it("is empty for no results (a degenerate corpus never invents a date)", () => {
    expect(newestDate(new Map())).toBe("");
  });
});

describe("toSubtypeSamples", () => {
  const CURRENT = new Set(["f1", "f2"]);

  it("buckets per subtype and keeps ONLY the two pairing-rule fields", () => {
    const grouped = groupByModel([
      resultFile("m/a", "2026-08-10", { f1: [1, 0.5], f2: [0] }, { f1: "numeric", f2: "prose" }),
    ]);
    const out = toSubtypeSamples(grouped, {}, CURRENT);
    expect(Object.keys(out).sort()).toEqual(["numeric", "prose"]);
    expect(out.numeric["m/a"].f1).toHaveLength(2);
    // The wall's mapping guarantee: nothing but the paired fields survives.
    expect(Object.keys(out.numeric["m/a"].f1[0]).sort()).toEqual([
      "schemaConform",
      "valueAccuracy",
    ]);
  });

  it("an untagged fixture joins NO subtype (no default bucket)", () => {
    const grouped = groupByModel([
      resultFile("m/a", "2026-08-10", { f1: [1], f2: [1] }, { f1: "numeric" }),
    ]);
    const out = toSubtypeSamples(grouped, {}, CURRENT);
    expect(Object.keys(out)).toEqual(["numeric"]);
  });

  it("the injected corpus map fills in when the result file predates fixtureSubtypes", () => {
    const grouped = groupByModel([resultFile("m/a", "2026-08-10", { f1: [1] }, undefined)]);
    const out = toSubtypeSamples(grouped, { f1: "numeric" }, CURRENT);
    expect(Object.keys(out)).toEqual(["numeric"]);
  });

  it("composes a supplemental run with the prior full run (newest wins per fixture)", () => {
    const grouped = groupByModel([
      // Older full run: f1 + f2.
      resultFile("m/a", "2026-08-01", { f1: [0], f2: [0] }, { f1: "numeric", f2: "prose" }),
      // Newer supplemental run: f1 only, different outcomes.
      resultFile("m/a", "2026-08-12", { f1: [1] }, { f1: "numeric" }),
    ]);
    const out = toSubtypeSamples(grouped, {}, CURRENT);
    // f1 comes from the NEWER file…
    expect(out.numeric["m/a"].f1.map((s) => s.valueAccuracy)).toEqual([1]);
    // …and f2 is pulled forward from the older file, not lost.
    expect(out.prose["m/a"].f2.map((s) => s.valueAccuracy)).toEqual([0]);
  });

  it("a retired fixture id in an old file is never resurrected", () => {
    const grouped = groupByModel([
      resultFile("m/a", "2026-08-01", { retired: [1] }, { retired: "numeric" }),
      resultFile("m/a", "2026-08-12", { f1: [1] }, { f1: "numeric" }),
    ]);
    const out = toSubtypeSamples(grouped, {}, CURRENT); // "retired" ∉ CURRENT
    expect(Object.keys(out.numeric["m/a"])).toEqual(["f1"]);
  });
});

describe("loadBasket — fail-loud on a malformed anchor", () => {
  const dir = mkdtempSync(join(tmpdir(), "rigindex-basket-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("loads a valid basket file", () => {
    const path = join(dir, "valid.json");
    writeFileSync(path, JSON.stringify({ version: "2026-Q3", members: ["a/x", "b/y"] }));
    const basket = loadBasket(path);
    expect(basket.version).toBe("2026-Q3");
    expect(basket.members).toEqual(["a/x", "b/y"]);
  });

  it("throws on a basket missing version or members — never a silent scale", () => {
    const noVersion = join(dir, "no-version.json");
    writeFileSync(noVersion, JSON.stringify({ members: ["a/x"] }));
    expect(() => loadBasket(noVersion)).toThrow(/version \+ members/);

    const noMembers = join(dir, "no-members.json");
    writeFileSync(noMembers, JSON.stringify({ version: "2026-Q3" }));
    expect(() => loadBasket(noMembers)).toThrow(/version \+ members/);
  });

  it("the COMMITTED basket file is valid and dated 2026-Q3 with the ratified trio", () => {
    const basket = loadBasket(); // default path: registry/rigindex-basket.json
    expect(basket.version).toBe("2026-Q3");
    expect([...basket.members].sort()).toEqual([
      "anthropic/claude-fable-5",
      "anthropic/claude-opus-5",
      "openai/gpt-5.5",
    ]);
  });
});
