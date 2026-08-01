/**
 * Declared-layer generator — spec WS3. Sources: the vendored LiteLLM pricing
 * map (capability flags, with provenance) + our adapter static capability
 * maps. Model list = every model with probe results (results dir) plus any
 * extra keys passed as argv.
 *
 * Usage: tsx registry/build-declared.ts [--results <dir>] [--out <file>] [model_key ...]
 * Output: registry/layers/declared.json  { [model_key]: DeclaredLayer }
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createDeepSeekAdapter, createGeminiAdapter, createOpenAIAdapter, getPricing } from "../src/index";
import type { ProviderAdapter, ProviderId } from "../src/index";
import type { DeclaredLayer } from "../src/registry/build";

const PKG_ROOT = join(__dirname, "..");
const DEFAULT_RESULTS_DIR = join(PKG_ROOT, "..", "modelrig-probes", "results");
const DEFAULT_OUT = join(__dirname, "layers", "declared.json");

interface PricingMapEntry {
  readonly supports_response_schema?: boolean;
  readonly supports_web_search?: boolean;
  readonly supports_prompt_caching?: boolean;
  readonly input_cost_per_token?: number;
  readonly output_cost_per_token?: number;
}

const KEY_PREFIXES: Record<string, readonly string[]> = {
  gemini: ["gemini/"],
  openai: ["", "openai/"],
  deepseek: ["deepseek/", ""],
};

function pricingMapEntry(
  map: Record<string, PricingMapEntry>,
  provider: string,
  model: string
): PricingMapEntry | null {
  for (const prefix of KEY_PREFIXES[provider] ?? [""]) {
    const entry = map[`${prefix}${model}`];
    if (entry !== undefined) return entry;
  }
  return null;
}

/** Model keys discovered from probe-result directories (provider-model
 * flattened dirs hold files that carry the real modelKey inside). */
function modelKeysFromResults(resultsDir: string): string[] {
  const keys = new Set<string>();
  let dirs: string[] = [];
  try {
    dirs = readdirSync(resultsDir);
  } catch {
    return [];
  }
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = readdirSync(join(resultsDir, dir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const parsed = JSON.parse(readFileSync(join(resultsDir, dir, file), "utf8")) as {
          modelKey?: string;
        };
        if (typeof parsed.modelKey === "string") keys.add(parsed.modelKey);
      } catch {
        // skip unparseable files
      }
    }
  }
  return [...keys].sort();
}

function adapterFor(provider: ProviderId): ProviderAdapter | null {
  // Static capability maps need no real key — adapters are constructed with a
  // placeholder and used ONLY for supports() (no network calls here).
  switch (provider) {
    case "gemini":
      return createGeminiAdapter({ apiKey: "declared-layer-static" });
    case "openai":
      return createOpenAIAdapter({ apiKey: "declared-layer-static" });
    case "deepseek":
      return createDeepSeekAdapter({ apiKey: "declared-layer-static" });
    default:
      return null;
  }
}

export function buildDeclaredLayer(modelKey: string, asOf: string): DeclaredLayer | null {
  const slash = modelKey.indexOf("/");
  if (slash <= 0) return null;
  const provider = modelKey.slice(0, slash) as ProviderId;
  const model = modelKey.slice(slash + 1);

  const map = JSON.parse(
    readFileSync(join(PKG_ROOT, "data", "pricing-map.json"), "utf8")
  ) as Record<string, PricingMapEntry>;
  const entry = pricingMapEntry(map, provider, model);
  const pricing = getPricing(provider, model);
  const adapter = adapterFor(provider);

  return {
    as_of: asOf,
    source: "litellm-pricing-map(pinned)+adapter-static",
    pricing:
      pricing === null
        ? null
        : {
            input_usd_per_mtok: pricing.inputUsdPerTok * 1e6,
            output_usd_per_mtok: pricing.outputUsdPerTok * 1e6,
            cached_input_usd_per_mtok:
              pricing.cachedInputUsdPerTok === null ? null : pricing.cachedInputUsdPerTok * 1e6,
          },
    flags: {
      supports_response_schema: entry?.supports_response_schema ?? null,
      supports_web_search: entry?.supports_web_search ?? null,
      supports_prompt_caching: entry?.supports_prompt_caching ?? null,
      adapter_structured_native: adapter === null ? null : adapter.supports("structured_native", model),
      adapter_grounded_native: adapter === null ? null : adapter.supports("grounded_native", model),
    },
  };
}

function main(): void {
  const args = process.argv.slice(2);
  let resultsDir = DEFAULT_RESULTS_DIR;
  let out = DEFAULT_OUT;
  const extraKeys: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--results") resultsDir = args[++i];
    else if (args[i] === "--out") out = args[++i];
    else extraKeys.push(args[i]);
  }

  const asOf = new Date().toISOString();
  const keys = [...new Set([...modelKeysFromResults(resultsDir), ...extraKeys])].sort();
  const layers: Record<string, DeclaredLayer> = {};
  for (const key of keys) {
    const layer = buildDeclaredLayer(key, asOf);
    if (layer !== null) layers[key] = layer;
    else console.warn(`skipping unresolvable model key "${key}"`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(layers, null, 2)}\n`);
  console.log(`declared layer: ${Object.keys(layers).length} models → ${out}`);
}

if (require.main === module) main();
