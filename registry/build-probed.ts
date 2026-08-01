/**
 * Probed-layer generator — spec WS3: merged from probe result files, latest
 * per model×class, with date + harness version.
 *
 * Usage: tsx registry/build-probed.ts [--results <dir>] [--out <file>]
 * Output: registry/layers/probed.json  { [model_key]: ProbedLayer }
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildProbedLayer } from "../src/registry/build";
import type { ProbeResultFile, ProbedLayer } from "../src/registry/build";

const DEFAULT_RESULTS_DIR = join(__dirname, "..", "..", "modelrig-probes", "results");
const DEFAULT_OUT = join(__dirname, "layers", "probed.json");

export function loadResultFiles(resultsDir: string): ProbeResultFile[] {
  const results: ProbeResultFile[] = [];
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
        const parsed = JSON.parse(
          readFileSync(join(resultsDir, dir, file), "utf8")
        ) as ProbeResultFile;
        if (typeof parsed.modelKey === "string" && typeof parsed.class === "string") {
          results.push(parsed);
        }
      } catch {
        console.warn(`skipping unparseable result file ${dir}/${file}`);
      }
    }
  }
  return results;
}

function main(): void {
  const args = process.argv.slice(2);
  let resultsDir = DEFAULT_RESULTS_DIR;
  let out = DEFAULT_OUT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--results") resultsDir = args[++i];
    else if (args[i] === "--out") out = args[++i];
  }

  const all = loadResultFiles(resultsDir);
  const byModel = new Map<string, ProbeResultFile[]>();
  for (const result of all) {
    const list = byModel.get(result.modelKey) ?? [];
    list.push(result);
    byModel.set(result.modelKey, list);
  }

  const layers: Record<string, ProbedLayer> = {};
  for (const [modelKey, results] of [...byModel.entries()].sort()) {
    const layer = buildProbedLayer(results);
    if (layer !== null) layers[modelKey] = layer;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(layers, null, 2)}\n`);
  console.log(`probed layer: ${Object.keys(layers).length} models → ${out}`);
}

if (require.main === module) main();
