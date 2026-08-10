/**
 * Declared-layer pricing_v2 population — pricing-first-class spec §5.
 *
 * Drives buildDeclaredLayer over the REAL committed key universe
 * (registry/layers/declared.json) against the on-disk snapshot + overlay, so
 * these are integration checks of the actual resolution, not synthetic mocks:
 *   - backward-compat: pricing_v2.base equals the flat `pricing` field, entry-for-entry;
 *   - golden multiplier: fireworks/kimi-k3 priority = base×1.25, fast = base×1.5;
 *   - fail-closed: a snapshot-only model degrades to base with tiers==null.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDeclaredLayer } from "./build-declared";
import { tierRates } from "../src/registry/pricing-shape";

const AS_OF = "2026-08-09";

function committedKeys(): string[] {
  const layers = JSON.parse(
    readFileSync(join(__dirname, "layers", "declared.json"), "utf8")
  ) as Record<string, unknown>;
  return Object.keys(layers);
}

describe("buildDeclaredLayer — pricing_v2 population", () => {
  it("populates pricing_v2 iff flat pricing is present, for every real key", () => {
    for (const key of committedKeys()) {
      const layer = buildDeclaredLayer(key, AS_OF);
      expect(layer, key).not.toBeNull();
      if (layer!.pricing === null) {
        expect(layer!.pricing_v2 ?? null, key).toBeNull();
      } else {
        expect(layer!.pricing_v2, key).not.toBeNull();
      }
    }
  });

  it("backward-compat: pricing_v2.base equals the flat pricing (× 1e6) for every entry", () => {
    for (const key of committedKeys()) {
      const layer = buildDeclaredLayer(key, AS_OF);
      const flat = layer?.pricing;
      const v2 = layer?.pricing_v2;
      if (flat === null || flat === undefined || v2 === null || v2 === undefined) continue;
      // TokenRates are per-token; the flat field is per-Mtok.
      expect(v2.base.input * 1e6, `${key} input`).toBeCloseTo(flat.input_usd_per_mtok, 9);
      expect(v2.base.output * 1e6, `${key} output`).toBeCloseTo(flat.output_usd_per_mtok, 9);
      if (flat.cached_input_usd_per_mtok === null) {
        expect(v2.base.cache_read ?? null, `${key} cache_read`).toBeNull();
      } else {
        expect((v2.base.cache_read ?? 0) * 1e6, `${key} cache_read`).toBeCloseTo(
          flat.cached_input_usd_per_mtok,
          9
        );
      }
    }
  });

  it("GOLDEN: fireworks/kimi-k3 priority = base×1.25, fast = base×1.5", () => {
    const layer = buildDeclaredLayer("fireworks/kimi-k3", AS_OF);
    const v2 = layer?.pricing_v2;
    expect(v2, "kimi-k3 must carry pricing_v2").not.toBeNull();
    expect(v2!.tiers?.priority).toBe(1.25);
    expect(v2!.tiers?.fast).toBe(1.5);
    expect(v2!.tiers?.region_us).toBe(1.1);
    // base is $3 in / $15 out per 1M (per-token 3e-6 / 1.5e-5).
    expect(v2!.base.input).toBeCloseTo(3.0e-6, 12);
    expect(v2!.base.output).toBeCloseTo(1.5e-5, 12);
    // The load-bearing check: absolute tier rates are base × multiplier.
    const priority = tierRates(v2!, "priority");
    const fast = tierRates(v2!, "fast");
    expect(priority?.input).toBeCloseTo(3.75e-6, 12); // $3.75/M
    expect(fast?.input).toBeCloseTo(4.5e-6, 12); // $4.50/M
    expect(priority?.output).toBeCloseTo(1.875e-5, 12); // $18.75/M
    expect(fast?.output).toBeCloseTo(2.25e-5, 12); // $22.50/M
    // basis is present — no un-caveated headline.
    expect(v2!.basis.length).toBeGreaterThan(0);
  });

  it("fail-closed: a snapshot-only model degrades to base with tiers==null", () => {
    const layer = buildDeclaredLayer("openai/gpt-4o-mini", AS_OF);
    const v2 = layer?.pricing_v2;
    expect(v2, "gpt-4o-mini must carry pricing_v2").not.toBeNull();
    expect(v2!.tiers ?? null).toBeNull();
    expect(v2!.context_bands ?? null).toBeNull();
    expect(v2!.batch_discount ?? null).toBeNull();
    expect(v2!.basis.length).toBeGreaterThan(0);
    expect(tierRates(v2!, "priority")).toBeNull();
  });
});
