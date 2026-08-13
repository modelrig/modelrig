/**
 * Probed-layer generator — spec WS3: merged from probe result files, latest
 * per model×class, with date + harness version.
 *
 * Usage: tsx registry/build-probed.ts [--results <dir>] [--out <file>]
 * Output: registry/layers/probed.json  { [model_key]: ProbedLayer }
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildProbedLayer } from "../src/registry/build";
import type { ProbeResultFile, ProbedLayer } from "../src/registry/build";

const DEFAULT_RESULTS_DIR = join(__dirname, "..", "..", "modelrig-probes", "results");
const DEFAULT_FIXTURES_DIR = join(__dirname, "..", "..", "modelrig-probes", "fixtures");
const DEFAULT_OUT = join(__dirname, "layers", "probed.json");

/**
 * Fixture ids that appear in PUBLISHED result files but no longer exist in
 * the fixture corpus (retired or replaced), mapped to their task subtype.
 * Subtype groups by task TYPE, not fixture identity — the aggregate columns
 * already compare rows probed on different corpus vintages — so a retired
 * fixture's samples still belong to its task's bucket. Without this, the
 * 2026-08-10 morning-batch results (probed before demo-support-summarize was
 * replaced by example.support_summarize, different hash) silently lose their
 * summarize bucket. QA regression gate: build-leaderboard.test.ts asserts
 * every full 65-sample row carries all 7 subtypes.
 */
const RETIRED_FIXTURE_SUBTYPES: Readonly<Record<string, string>> = {
  "demo-support-summarize": "summarize",
};

/**
 * fixtureId → subtype from the CURRENT fixture corpus (www-clarity §5.5 W16),
 * plus the retired-id map above (current fixtures win on a collision).
 * Subtype is hash-excluded retro-taggable metadata, so applying today's tags
 * to results that predate the field is the sanctioned pattern — it is how
 * by_subtype ships from EXISTING results without a probe run. A result that
 * already carries its own fixtureSubtypes (future cycles) keeps it.
 */
export function loadFixtureSubtypes(
  fixturesDir: string = DEFAULT_FIXTURES_DIR
): Record<string, string> {
  const out: Record<string, string> = { ...RETIRED_FIXTURE_SUBTYPES };
  const dir = join(fixturesDir, "schema");
  if (!existsSync(dir)) return out;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        id?: string;
        subtype?: string;
      };
      if (typeof fixture.id === "string" && typeof fixture.subtype === "string") {
        out[fixture.id] = fixture.subtype;
      }
    } catch {
      // A malformed fixture file is the fixture loader's problem, not this map's.
    }
  }
  return out;
}

/** Ids of the fixtures CURRENTLY in the schema corpus (fixtures/schema/*.json),
 * WITHOUT the retired-id map — the allow-list mergeSchemaResults uses to pull a
 * fixture forward from an older result file, so a retired id is never
 * resurrected. Distinct from loadFixtureSubtypes (which includes retired ids to
 * TAG samples already present). */
export function loadCurrentSchemaFixtureIds(
  fixturesDir: string = DEFAULT_FIXTURES_DIR
): Set<string> {
  const ids = new Set<string>();
  const dir = join(fixturesDir, "schema");
  if (!existsSync(dir)) return ids;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as { id?: string };
      if (typeof fixture.id === "string") ids.add(fixture.id);
    } catch {
      // malformed fixture — the loader's problem, not this map's
    }
  }
  return ids;
}

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

  const subtypeById = loadFixtureSubtypes();
  const all = loadResultFiles(resultsDir).map((result) =>
    result.class === "schema" && result.fixtureSubtypes === undefined
      ? { ...result, fixtureSubtypes: subtypeById }
      : result
  );
  const byModel = new Map<string, ProbeResultFile[]>();
  for (const result of all) {
    const list = byModel.get(result.modelKey) ?? [];
    list.push(result);
    byModel.set(result.modelKey, list);
  }

  // The live schema corpus — so a supplemental run (e.g. cycle-003b's coverage
  // fixtures) COMPOSES with the prior full cycle instead of replacing it, while
  // a retired id in an old file is never pulled forward.
  const currentSchemaIds = loadCurrentSchemaFixtureIds();
  const layers: Record<string, ProbedLayer> = {};
  for (const [modelKey, results] of [...byModel.entries()].sort()) {
    const layer = buildProbedLayer(results, currentSchemaIds);
    if (layer !== null) layers[modelKey] = layer;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(layers, null, 2)}\n`);
  console.log(`probed layer: ${Object.keys(layers).length} models → ${out}`);
}

if (require.main === module) main();
