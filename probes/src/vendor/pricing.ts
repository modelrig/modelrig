/**
 * Vendored pricing accessor — post-C2 patch P2. Reads the LiteLLM-derived
 * pricing snapshot from whichever layout this repo is in:
 *   - workspace:   packages/modelrig/data/pricing-map.json
 *   - public repo: registry/data/pricing-map.json
 * Cost math ported from ModelRig's registry/pricing.ts (cached tokens billed
 * at the cached rate, never negatively).
 *
 * Data source: model_prices_and_context_window.json,
 * Copyright (c) 2023 Berri AI, MIT License (https://github.com/BerriAI/litellm).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProbeProviderId } from "./types";

export interface ProbeModelPricing {
  readonly inputUsdPerTok: number;
  readonly outputUsdPerTok: number;
  readonly cachedInputUsdPerTok: number | null;
}

interface PricingMapEntry {
  readonly input_cost_per_token?: number;
  readonly output_cost_per_token?: number;
  readonly cache_read_input_token_cost?: number;
}

const KEY_PREFIXES: Record<ProbeProviderId, readonly string[]> = {
  gemini: ["gemini/"],
  openai: ["", "openai/"],
  deepseek: ["deepseek/", ""],
  anthropic: ["anthropic/", ""],
  grok: ["xai/"],
  // A1 hosts — must mirror src/registry/pricing.ts exactly: DeepInfra keeps the
  // org path ("Qwen/QwQ-32B"); Fireworks pricing keys carry the wire prefix.
  deepinfra: ["deepinfra/"],
  fireworks: ["fireworks_ai/accounts/fireworks/models/", "fireworks_ai/"],
};

/** Both repo layouts, relative to this file (src/vendor or dist/vendor —
 * both sit two levels below the package root). */
function candidatePaths(): string[] {
  const packagesOrRepoRoot = join(__dirname, "..", "..", "..");
  return [
    join(packagesOrRepoRoot, "modelrig", "data", "pricing-map.json"),
    join(packagesOrRepoRoot, "registry", "data", "pricing-map.json"),
  ];
}

let cachedMap: Record<string, PricingMapEntry> | null = null;

/** Host-swept gap-filler sitting next to the snapshot (pricing-overlay.json,
 * written by modelrig's scripts/pricing-sweep.ts) — prices the pinned snapshot
 * has not caught up to. Merged BENEATH the snapshot (snapshot wins on shared
 * keys). Absent ⇒ unchanged behaviour. */
function loadOverlay(snapshotPath: string): Record<string, PricingMapEntry> {
  const overlayPath = join(dirname(snapshotPath), "pricing-overlay.json");
  if (!existsSync(overlayPath)) return {};
  const parsed = JSON.parse(readFileSync(overlayPath, "utf8")) as {
    prices?: Record<string, PricingMapEntry>;
  };
  return parsed.prices ?? {};
}

function loadMap(): Record<string, PricingMapEntry> {
  if (cachedMap === null) {
    const paths = candidatePaths();
    const found = paths.find((p) => existsSync(p));
    if (found === undefined) {
      throw new Error(
        `pricing snapshot not found — looked in:\n${paths.map((p) => `  ${p}`).join("\n")}\n` +
          "(probe costs and envelopes need it; is the repo checkout complete?)"
      );
    }
    const snapshot = JSON.parse(readFileSync(found, "utf8")) as Record<string, PricingMapEntry>;
    cachedMap = { ...loadOverlay(found), ...snapshot };
  }
  return cachedMap;
}

export function getProbePricing(provider: ProbeProviderId, model: string): ProbeModelPricing | null {
  if (model === "") return null;
  const map = loadMap();
  for (const prefix of KEY_PREFIXES[provider]) {
    const entry = map[`${prefix}${model}`];
    if (
      entry !== undefined &&
      typeof entry.input_cost_per_token === "number" &&
      typeof entry.output_cost_per_token === "number"
    ) {
      return {
        inputUsdPerTok: entry.input_cost_per_token,
        outputUsdPerTok: entry.output_cost_per_token,
        cachedInputUsdPerTok:
          typeof entry.cache_read_input_token_cost === "number"
            ? entry.cache_read_input_token_cost
            : null,
      };
    }
  }
  return null;
}

export function estimateProbeCostUsd(
  pricing: ProbeModelPricing,
  tokensIn: number,
  tokensOut: number,
  tokensCached: number
): number {
  const cached = Math.min(Math.max(tokensCached, 0), Math.max(tokensIn, tokensCached));
  const uncachedIn = Math.max(tokensIn - cached, 0);
  const cachedRate = pricing.cachedInputUsdPerTok ?? pricing.inputUsdPerTok;
  return (
    uncachedIn * pricing.inputUsdPerTok +
    cached * cachedRate +
    Math.max(tokensOut, 0) * pricing.outputUsdPerTok
  );
}

/** Sample cost for a caller's usage — the one-liner every class runner needs. */
export function probeSampleCostUsd(
  provider: ProbeProviderId,
  model: string,
  usage: { tokensIn: number; tokensOut: number; tokensCached: number }
): number {
  const pricing = getProbePricing(provider, model);
  if (pricing === null) return 0;
  return estimateProbeCostUsd(pricing, usage.tokensIn, usage.tokensOut, usage.tokensCached);
}
