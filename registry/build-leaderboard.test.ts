/**
 * Leaderboard rendering — corpus/family provenance (demo-rig §11.3b) and the
 * coverage note that must describe the corpus it actually has.
 */

import { describe, expect, it } from "vitest";
import {
  corpusSummary,
  renderLeaderboardHtml,
  servingPathLabel,
  toLeaderboardRows,
} from "./build-leaderboard";
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
});
