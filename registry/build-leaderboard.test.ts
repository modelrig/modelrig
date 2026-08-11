/**
 * Leaderboard rendering — corpus/family provenance (demo-rig §11.3b) and the
 * coverage note that must describe the corpus it actually has.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  corpusSummary,
  FAMILY_MIN_N,
  renderLeaderboardHtml,
  servingPathLabel,
  toLeaderboardRows,
} from "./build-leaderboard";
import {
  assertParityCoverageSane,
  computeParity,
  registryHasProbedModels,
  type ParityListEntry,
} from "../src/registry/parity";
import type { Registry } from "../src/registry/build";

function registryWith(models: Registry["models"]): Registry {
  return { generated_at: "2026-08-08T00:00:00.000Z", license: "CC-BY-4.0", models };
}

const NOW = new Date("2026-08-08T00:00:00.000Z");

describe("corpusSummary", () => {
  const summary = corpusSummary();

  it("names the fixture families it actually has (probe-suite + demo-rig)", () => {
    expect(summary).toMatch(/probe-suite/);
    expect(summary).toMatch(/demo-rig/);
  });

  it("carries the synthetic-fixture caveat and no longer claims finance-only", () => {
    expect(summary).toMatch(/not a claim about any customer's workload/);
    // once demo-rig lands, finance is < 50% of the corpus → not finance-weighted
    expect(summary).not.toMatch(/finance-weighted/);
  });
});

describe("parity-50 coverage gate on the committed data (regression gate)", () => {
  // Un-forgettable mechanical gate: load the ACTUAL registry.json +
  // parity-50.json that ship, and assert the join does not silently collapse to
  // 0 while probed models exist. If a future cycle renames ids and breaks the
  // join, THIS fails in CI before the false-0 leaderboard is published.
  const registry = JSON.parse(
    readFileSync(join(__dirname, "registry.json"), "utf8")
  ) as Registry;
  const list = JSON.parse(readFileSync(join(__dirname, "parity-50.json"), "utf8")) as {
    models: ParityListEntry[];
  };

  it("real committed registry joins the parity list without collapsing to 0", () => {
    const parity = computeParity(list.models, registry);
    expect(registryHasProbedModels(registry)).toBe(true);
    expect(parity.probed).toBeGreaterThan(0);
    expect(() => assertParityCoverageSane(parity, registry)).not.toThrow();
  });

  it("the gate WOULD fire if the join were broken (proves it is not vacuous)", () => {
    // Same registry, but a parity list whose keys match nothing → 0 probed
    // while probed data exists → must throw.
    const brokenList = [{ name: "X", registry_keys: ["bogus/unmatched"] }];
    expect(() => assertParityCoverageSane(computeParity(brokenList, registry), registry)).toThrow(
      /join/i
    );
  });
});

describe("leaderboard rows carry corpus provenance", () => {
  it("a model probed only by demo-rig fixtures is marked so", () => {
    const registry = registryWith([
      {
        model_key: "p/demo-only",
        declared: null,
        probed: {
          as_of: "2026-08-08T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: 5,
            parse_rate: 1,
            conform_rate: 1,
            conform_ci95: [0.5, 1],
            value_accuracy_mean: 1,
            native_rung_rate: 0,
            mean_cost_usd: 0.001,
            by_family: { "demo-rig": { samples: 5, conform_rate: 1, conform_ci95: [0.5, 1], value_accuracy_mean: 1, native_rung_rate: 0 } },
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
    const rows = toLeaderboardRows(registry);
    expect(rows[0].families).toEqual(["demo-rig"]);
    const html = renderLeaderboardHtml(registry, rows, NOW);
    expect(html).toMatch(/demo-rig only/);
    expect(html).toMatch(/<th>Corpus<\/th>/);
  });

  it("renders the hard-subset column from by_difficulty (discriminating-fixtures §3)", () => {
    const registry = registryWith([
      {
        model_key: "p/model",
        declared: null,
        probed: {
          as_of: "2026-08-09T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: 10,
            parse_rate: 1,
            conform_rate: 1,
            conform_ci95: [0.7, 1],
            value_accuracy_mean: 0.6,
            native_rung_rate: 1,
            mean_cost_usd: 0.001,
            by_difficulty: {
              standard: { samples: 7, conform_rate: 1, conform_ci95: [0.6, 1], value_accuracy_mean: 1, native_rung_rate: 1 },
              hard: { samples: 3, conform_rate: 1, conform_ci95: [0.4, 1], value_accuracy_mean: 0.22, native_rung_rate: 1 },
            },
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
    const rows = toLeaderboardRows(registry);
    expect(rows[0].hard_conform_rate).toBe(1);
    expect(rows[0].hard_value_accuracy_mean).toBe(0.22);
    expect(rows[0].hard_samples).toBe(3);
    const html = renderLeaderboardHtml(registry, rows, NOW);
    expect(html).toMatch(/<th[^>]*>Hard conf\.<\/th>/);
    expect(html).toMatch(/acc 22%/); // hard value-accuracy rendered inline
  });

  it("labels the hard-subset serving path so a coached miss reads 'coached, missed' (follow-up 3a)", () => {
    // Two models, same hard conformance, DIFFERENT serving path: one served the
    // strict fixtures natively, one was coached via json_mode. The label lets a
    // reader interpret a miss — it never excludes either model.
    const registry = registryWith([
      {
        model_key: "p/native-model",
        declared: null,
        probed: {
          as_of: "2026-08-09T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: 6, parse_rate: 1, conform_rate: 0.5, conform_ci95: [0.2, 0.8],
            value_accuracy_mean: 0.5, native_rung_rate: 1, mean_cost_usd: 0.001,
            by_difficulty: {
              hard: { samples: 3, conform_rate: 0.5, conform_ci95: [0.1, 0.9], value_accuracy_mean: 0.5, native_rung_rate: 1 },
            },
          },
          grounding: null, caching: null,
        },
        observed: null, discrepancies: [], callNotes: [], facts: null,
      },
      {
        model_key: "p/coached-model",
        declared: null,
        probed: {
          as_of: "2026-08-09T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: 6, parse_rate: 1, conform_rate: 0.5, conform_ci95: [0.2, 0.8],
            value_accuracy_mean: 0.5, native_rung_rate: 0, mean_cost_usd: 0.001,
            by_difficulty: {
              hard: { samples: 3, conform_rate: 0.5, conform_ci95: [0.1, 0.9], value_accuracy_mean: 0.5, native_rung_rate: 0 },
            },
          },
          grounding: null, caching: null,
        },
        observed: null, discrepancies: [], callNotes: [], facts: null,
      },
    ]);
    const rows = toLeaderboardRows(registry);
    expect(rows.find((r) => r.model_key === "p/native-model")?.hard_native_rung_rate).toBe(1);
    expect(rows.find((r) => r.model_key === "p/coached-model")?.hard_native_rung_rate).toBe(0);
    const html = renderLeaderboardHtml(registry, rows, NOW);
    // Both models rendered (nothing excluded) with their serving-path label.
    expect(html).toMatch(/p\/native-model/);
    expect(html).toMatch(/p\/coached-model/);
    expect(html).toMatch(/path-native/);
    expect(html).toMatch(/path-coached/);
  });

  it("servingPathLabel maps the native-rung rate to a plain label", () => {
    expect(servingPathLabel(null)).toBeNull();
    expect(servingPathLabel(1)).toBe("native");
    expect(servingPathLabel(0)).toBe("coached");
    expect(servingPathLabel(0.6)).toBe("mixed · 60% native");
  });

  it("shows an em-dash in the hard column when a model has no hard-tier samples", () => {
    const registry = registryWith([
      {
        model_key: "p/nohard",
        declared: null,
        probed: {
          as_of: "2026-08-09T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: 5,
            parse_rate: 1,
            conform_rate: 1,
            conform_ci95: [0.5, 1],
            value_accuracy_mean: 1,
            native_rung_rate: 1,
            mean_cost_usd: 0.001,
            by_difficulty: { standard: { samples: 5, conform_rate: 1, conform_ci95: [0.5, 1], value_accuracy_mean: 1, native_rung_rate: 1 } },
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
    const rows = toLeaderboardRows(registry);
    expect(rows[0].hard_samples).toBe(0);
    expect(rows[0].hard_conform_rate).toBeNull();
  });

  it("unprobed models keep an empty families list (labeled, never hidden)", () => {
    const registry = registryWith([
      { model_key: "p/unprobed", declared: null, probed: null, observed: null, discrepancies: [], callNotes: [], facts: null },
    ]);
    const rows = toLeaderboardRows(registry);
    expect(rows[0].families).toEqual([]);
  });

  it("carries per-row fixture_counts {family: count} so provenance is real, not decorative (probe-cycle-001 contract addition)", () => {
    // A row measured by 8 authored demo fixtures + 30 field probes must say so —
    // `samples: 38` alone cannot. fixture_counts mirrors families: derived from
    // by_family (family -> its sample count), always present as an object.
    const registry = registryWith([
      {
        model_key: "p/mixed",
        declared: null,
        probed: {
          as_of: "2026-08-08T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: 38,
            parse_rate: 1,
            conform_rate: 1,
            conform_ci95: [0.7, 1],
            value_accuracy_mean: 1,
            native_rung_rate: 1,
            mean_cost_usd: 0.001,
            by_family: {
              "demo-rig": { samples: 8, conform_rate: 1, conform_ci95: [0.5, 1], value_accuracy_mean: 1, native_rung_rate: 1 },
              "probe-suite": { samples: 30, conform_rate: 1, conform_ci95: [0.8, 1], value_accuracy_mean: 1, native_rung_rate: 1 },
            },
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
    const rows = toLeaderboardRows(registry);
    expect(rows[0].fixture_counts).toEqual({ "demo-rig": 8, "probe-suite": 30 });
    // families and fixture_counts describe the same set of corpora.
    expect(Object.keys(rows[0].fixture_counts).sort()).toEqual(rows[0].families);
  });

  it("unprobed rows carry an empty fixture_counts object (present, not null — mirrors families:[])", () => {
    const registry = registryWith([
      { model_key: "p/unprobed", declared: null, probed: null, observed: null, discrepancies: [], callNotes: [], facts: null },
    ]);
    const rows = toLeaderboardRows(registry);
    expect(rows[0].fixture_counts).toEqual({});
  });

  it("a probed schema with no by_family (legacy result) still yields {} — never undefined", () => {
    // Distinct branch from probed:null — here the schema EXISTS but predates the
    // by_family rollup. fixture_counts must stay a present object so the www
    // consumer never null-guards the value, only keys off families.
    const registry = registryWith([
      {
        model_key: "p/no-family",
        declared: null,
        probed: {
          as_of: "2026-08-08T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: 5,
            parse_rate: 1,
            conform_rate: 1,
            conform_ci95: [0.5, 1],
            value_accuracy_mean: 1,
            native_rung_rate: 1,
            mean_cost_usd: 0.001,
            // no by_family
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
    const rows = toLeaderboardRows(registry);
    expect(rows[0].fixture_counts).toEqual({});
    expect(rows[0].families).toEqual([]);
  });
});

describe("leaderboard rows carry a per-family view (task-type-leaderboards spec §2.1)", () => {
  // A model probed on two families of unequal size: one above the min-n floor
  // (rates shown, effective cost derived from the per-family mean cost), one
  // below it (rates gated to null, samples retained so the "—" explains itself).
  function twoFamilyRegistry(): Registry {
    return registryWith([
      {
        model_key: "p/two-family",
        declared: null,
        probed: {
          as_of: "2026-08-10T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: FAMILY_MIN_N + 4,
            parse_rate: 1,
            conform_rate: 0.75,
            conform_ci95: [0.5, 1],
            value_accuracy_mean: 0.8,
            native_rung_rate: 1,
            mean_cost_usd: 0.002,
            by_family: {
              // healthy: FAMILY_MIN_N samples, conform 0.5, cost 0.002/sample
              extraction: {
                samples: FAMILY_MIN_N,
                conform_rate: 0.5,
                conform_ci95: [0.3, 0.7],
                value_accuracy_mean: 0.9,
                native_rung_rate: 1,
                mean_cost_usd: 0.002,
              },
              // thin: below the floor → rates gated to null, samples kept
              classification: {
                samples: FAMILY_MIN_N - 1,
                conform_rate: 1,
                conform_ci95: [0.6, 1],
                value_accuracy_mean: 1,
                native_rung_rate: 1,
                mean_cost_usd: 0.001,
              },
            },
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
  }

  it("rolls up conform/value-accuracy/samples and derives per-family effective cost", () => {
    const row = toLeaderboardRows(twoFamilyRegistry())[0];
    const extraction = row.by_family?.extraction;
    expect(extraction?.samples).toBe(FAMILY_MIN_N);
    expect(extraction?.conform_rate).toBe(0.5);
    expect(extraction?.value_accuracy_mean).toBe(0.9);
    // effective cost = mean_cost_usd / conform_rate * 1000 = 0.002 / 0.5 * 1000
    expect(extraction?.effective_usd_per_1k_conformant).toBeCloseTo(4, 6);
  });

  it("min-n gates a thin family's rates to null but keeps its sample count", () => {
    const row = toLeaderboardRows(twoFamilyRegistry())[0];
    const classification = row.by_family?.classification;
    expect(classification?.samples).toBe(FAMILY_MIN_N - 1); // count retained
    expect(classification?.conform_rate).toBeNull(); // gated
    expect(classification?.value_accuracy_mean).toBeNull(); // gated
    expect(classification?.effective_usd_per_1k_conformant).toBeNull(); // no confident price on "—"
  });

  it("emits by_subtype with the SAME rollup + min-n gate as by_family (www-clarity §5.5 W16)", () => {
    const base = twoFamilyRegistry().models[0];
    const withSubtype = registryWith([
      {
        ...base,
        probed: {
          ...base.probed!,
          schema: {
            ...base.probed!.schema!,
            by_subtype: {
              "extraction.tabular": {
                samples: FAMILY_MIN_N + 5,
                conform_rate: 1,
                conform_ci95: [0.8, 1],
                value_accuracy_mean: 0.95,
                native_rung_rate: 1,
                mean_cost_usd: 0.001,
              },
              "qa.docs": {
                samples: 5, // below the floor → gated
                conform_rate: 1,
                conform_ci95: [0.6, 1],
                value_accuracy_mean: 1,
                native_rung_rate: 1,
                mean_cost_usd: 0.001,
              },
            },
          },
        },
      },
    ]);
    const row = toLeaderboardRows(withSubtype)[0];
    const tabular = row.by_subtype?.["extraction.tabular"];
    expect(tabular?.value_accuracy_mean).toBe(0.95);
    // effective cost = mean_cost_usd / conform_rate * 1000 = 0.001 / 1 * 1000
    expect(tabular?.effective_usd_per_1k_conformant).toBeCloseTo(1, 6);
    const qaDocs = row.by_subtype?.["qa.docs"];
    expect(qaDocs?.samples).toBe(5); // count retained
    expect(qaDocs?.value_accuracy_mean).toBeNull(); // min-n gated
    expect(qaDocs?.effective_usd_per_1k_conformant).toBeNull();
  });

  it("omits by_subtype entirely when the probed layer carries none (legacy results)", () => {
    const row = toLeaderboardRows(twoFamilyRegistry())[0];
    expect(row.by_subtype).toBeUndefined();
  });

  it("the committed leaderboard carries by_subtype on every full 08-10 row (data regression gate)", () => {
    const committed = JSON.parse(
      readFileSync(join(__dirname, "leaderboard.json"), "utf8"),
    ) as Array<{ model_key: string; samples: number; by_subtype?: Record<string, unknown> }>;
    const fullRuns = committed.filter((row) => row.samples === 65);
    expect(fullRuns.length).toBeGreaterThanOrEqual(27);
    for (const row of fullRuns) {
      expect(
        Object.keys(row.by_subtype ?? {}).length,
        `${row.model_key} missing by_subtype`,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it("omits a family the model was not tested on (never a zero row)", () => {
    const row = toLeaderboardRows(twoFamilyRegistry())[0];
    expect(Object.keys(row.by_family ?? {}).sort()).toEqual(["classification", "extraction"]);
    expect(row.by_family?.grounding).toBeUndefined();
  });

  it("leaves effective cost null when the probed layer predates per-family mean_cost_usd", () => {
    // A by_family sub-summary without mean_cost_usd (legacy probed layer): rates
    // still roll up, but cost degrades to "—" rather than being invented.
    const registry = registryWith([
      {
        model_key: "p/no-cost",
        declared: null,
        probed: {
          as_of: "2026-08-09T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: FAMILY_MIN_N,
            parse_rate: 1,
            conform_rate: 1,
            conform_ci95: [0.7, 1],
            value_accuracy_mean: 1,
            native_rung_rate: 1,
            mean_cost_usd: 0.001,
            by_family: {
              extraction: {
                samples: FAMILY_MIN_N,
                conform_rate: 1,
                conform_ci95: [0.7, 1],
                value_accuracy_mean: 1,
                native_rung_rate: 1,
                // no mean_cost_usd
              },
            },
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
    const row = toLeaderboardRows(registry)[0];
    expect(row.by_family?.extraction.conform_rate).toBe(1);
    expect(row.by_family?.extraction.effective_usd_per_1k_conformant).toBeNull();
  });

  it("leaves effective cost null for a family that conforms on zero samples (no divide-by-zero)", () => {
    const registry = registryWith([
      {
        model_key: "p/zero-conform",
        declared: null,
        probed: {
          as_of: "2026-08-10T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: FAMILY_MIN_N,
            parse_rate: 1,
            conform_rate: 0,
            conform_ci95: [0, 0.3],
            value_accuracy_mean: 0,
            native_rung_rate: 0,
            mean_cost_usd: 0.002,
            by_family: {
              extraction: {
                samples: FAMILY_MIN_N,
                conform_rate: 0, // nothing conformed → effective cost undefined, not Infinity
                conform_ci95: [0, 0.3],
                value_accuracy_mean: 0,
                native_rung_rate: 0,
                mean_cost_usd: 0.002,
              },
            },
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
    const stats = toLeaderboardRows(registry)[0].by_family?.extraction;
    expect(stats?.conform_rate).toBe(0);
    expect(stats?.effective_usd_per_1k_conformant).toBeNull(); // never Infinity/NaN
  });

  it("back-compat: a legacy schema with no by_family yields no by_family field on the row", () => {
    const registry = registryWith([
      {
        model_key: "p/legacy",
        declared: null,
        probed: {
          as_of: "2026-08-08T00:00:00.000Z",
          source: "modelrig-probes@0.0.1",
          schema: {
            samples: 5,
            parse_rate: 1,
            conform_rate: 1,
            conform_ci95: [0.5, 1],
            value_accuracy_mean: 1,
            native_rung_rate: 1,
            mean_cost_usd: 0.001,
            // no by_family
          },
          grounding: null,
          caching: null,
        },
        observed: null,
        discrepancies: [],
        callNotes: [],
        facts: null,
      },
    ]);
    const row = toLeaderboardRows(registry)[0];
    expect(row.by_family).toBeUndefined();
    // the flat columns are untouched (back-compat)
    expect(row.conform_rate).toBe(1);
    expect(row.value_accuracy_mean).toBe(1);
  });
});
