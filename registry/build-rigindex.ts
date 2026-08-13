/**
 * RigIndex layer generator — Cycle 4 (rigindex-scoring/spec.md; math ratified
 * in stop2-architect-review.md §1). Computes the paired per-subtype rank from
 * EXISTING probe result files (no probe spend) and emits the additive
 * registry/layers/rigindex.json. Leaderboard rows may reference the layer;
 * they never inline-duplicate it.
 *
 * THE WALL (spec §6): this entrypoint consumes ONLY per-sample paired
 * outcomes (schemaConform, valueAccuracy) from result files. No telemetry,
 * no observed health, no marginal accuracy enters — rigindex-wall.test.ts
 * crawls this file's import closure and fails the build on a breach.
 *
 * Usage: tsx registry/build-rigindex.ts [--results <dir>] [--out <file>]
 *        [--seed <n>] [--reps <n>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  loadCurrentSchemaFixtureIds,
  loadFixtureSubtypes,
  loadResultFiles,
} from "./build-probed";
import { mergeSchemaResults } from "../src/registry/build";
import type { ProbeResultFile } from "../src/registry/build";
import { computeRigIndexLayer } from "../src/rigindex";
import type { PairedSample, SubtypeSamples } from "../src/rigindex/types";

const DEFAULT_RESULTS_DIR = join(__dirname, "..", "..", "modelrig-probes", "results");
const DEFAULT_OUT = join(__dirname, "layers", "rigindex.json");
const BASKET_PATH = join(__dirname, "rigindex-basket.json");

export interface BasketFile {
  readonly version: string;
  readonly members: readonly string[];
}

export function loadBasket(path: string = BASKET_PATH): BasketFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as BasketFile;
  if (typeof parsed.version !== "string" || !Array.isArray(parsed.members)) {
    throw new Error(`malformed basket file at ${path} — version + members required`);
  }
  return parsed;
}

/**
 * Map each model's MERGED schema result (same composition rule as the probed
 * layer: latest file is base, older current-corpus fixtures fill in, retired
 * ids never resurrected) into per-subtype per-(model, fixture) paired
 * samples. ONLY the two pairing-rule fields survive the mapping — the wall's
 * behavioral guarantee (cost, latency, parse, rung can never move a score).
 */
export function toSubtypeSamples(
  resultsByModel: ReadonlyMap<string, readonly ProbeResultFile[]>,
  subtypeById: Readonly<Record<string, string>>,
  currentFixtureIds: ReadonlySet<string>,
): Record<string, SubtypeSamples> {
  const out: Record<string, Record<string, Record<string, readonly PairedSample[]>>> = {};
  for (const [modelKey, results] of [...resultsByModel.entries()].sort()) {
    const merged = mergeSchemaResults(results, currentFixtureIds);
    if (merged === undefined) continue;
    for (const [fixtureId, samples] of Object.entries(merged.raw)) {
      const subtype = merged.fixtureSubtypes?.[fixtureId] ?? subtypeById[fixtureId];
      if (subtype === undefined) continue; // untagged fixture joins no subtype
      const paired: PairedSample[] = samples.map((s) => ({
        schemaConform: s.schemaConform,
        valueAccuracy: s.valueAccuracy,
      }));
      if (paired.length === 0) continue;
      out[subtype] ??= {};
      out[subtype][modelKey] ??= {};
      out[subtype][modelKey][fixtureId] = paired;
    }
  }
  return out;
}

/** Newest schema-result date across models — the layer's as_of. */
export function newestDate(
  resultsByModel: ReadonlyMap<string, readonly ProbeResultFile[]>,
): string {
  let newest = "";
  for (const results of resultsByModel.values()) {
    for (const result of results) {
      if (result.class === "schema" && result.date > newest) newest = result.date;
    }
  }
  return newest;
}

export function groupByModel(
  results: readonly ProbeResultFile[],
): Map<string, ProbeResultFile[]> {
  const byModel = new Map<string, ProbeResultFile[]>();
  for (const result of results) {
    if (result.class !== "schema") continue;
    const list = byModel.get(result.modelKey) ?? [];
    list.push(result);
    byModel.set(result.modelKey, list);
  }
  return byModel;
}

function main(): void {
  const args = process.argv.slice(2);
  let resultsDir = DEFAULT_RESULTS_DIR;
  let out = DEFAULT_OUT;
  let seed: number | undefined;
  let reps: number | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--results") resultsDir = args[++i];
    else if (args[i] === "--out") out = args[++i];
    else if (args[i] === "--seed") seed = Number(args[++i]);
    else if (args[i] === "--reps") reps = Number(args[++i]);
  }

  const basket = loadBasket();
  const subtypeById = loadFixtureSubtypes();
  const currentIds = loadCurrentSchemaFixtureIds();
  const byModel = groupByModel(loadResultFiles(resultsDir));
  const subtypeSamples = toSubtypeSamples(byModel, subtypeById, currentIds);

  const versions = [...byModel.values()]
    .flat()
    .map((r) => r.harnessVersion)
    .sort();
  const layer = computeRigIndexLayer(
    subtypeSamples,
    basket,
    {
      asOf: newestDate(byModel),
      source: `modelrig-probes@${versions[versions.length - 1] ?? "unknown"}+rigindex-v1 (probe-derived, single source)`,
    },
    { seed, reps },
  );

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(layer, null, 2)}\n`);
  const states = Object.entries(layer.subtypes)
    .map(([name, s]) => `${name}=${s.state}(${s.tiers} tier${s.tiers === 1 ? "" : "s"})`)
    .join(" · ");
  console.log(`rigindex layer: ${Object.keys(layer.subtypes).length} subtypes → ${out}`);
  console.log(`  ${states}`);
}

if (require.main === module) main();
