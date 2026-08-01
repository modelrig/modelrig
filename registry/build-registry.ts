/**
 * Registry assembly — merges the three layer files into registry.json
 * (the public CC-BY artifact; FILES are source of truth, the Supabase
 * registry_models table is a console mirror synced separately).
 *
 * Usage: tsx registry/build-registry.ts [--layers <dir>] [--out <file>]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildRegistry } from "../src/registry/build";
import type { DeclaredLayer, ObservedLayer, ProbedLayer } from "../src/registry/build";

const DEFAULT_LAYERS_DIR = join(__dirname, "layers");
const DEFAULT_OUT = join(__dirname, "registry.json");

function readLayer<T>(layersDir: string, name: string): Record<string, T> {
  const path = join(layersDir, `${name}.json`);
  if (!existsSync(path)) {
    console.warn(`layer file missing (${name}.json) — building without it`);
    return {};
  }
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, T>;
}

function main(): void {
  const args = process.argv.slice(2);
  let layersDir = DEFAULT_LAYERS_DIR;
  let out = DEFAULT_OUT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--layers") layersDir = args[++i];
    else if (args[i] === "--out") out = args[++i];
  }

  const declared = readLayer<DeclaredLayer>(layersDir, "declared");
  const probed = readLayer<ProbedLayer>(layersDir, "probed");
  const observed = readLayer<ObservedLayer>(layersDir, "observed");

  const modelKeys = [
    ...new Set([...Object.keys(declared), ...Object.keys(probed), ...Object.keys(observed)]),
  ].sort();

  const registry = buildRegistry(
    modelKeys.map((key) => ({
      model_key: key,
      declared: declared[key] ?? null,
      probed: probed[key] ?? null,
      observed: observed[key] ?? null,
    })),
    new Date().toISOString()
  );

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(registry, null, 2)}\n`);
  const discrepancyCount = registry.models.reduce((a, m) => a + m.discrepancies.length, 0);
  console.log(
    `registry.json: ${registry.models.length} models, ${discrepancyCount} discrepancies → ${out}`
  );
}

if (require.main === module) main();
