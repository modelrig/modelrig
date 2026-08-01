/**
 * Leaderboard static generator — spec WS3: registry.json → leaderboard.html
 * (for modelrig.dev) + leaderboard.json (data consumers). Ranked by
 * "conformance per dollar" (effective $ per 1K conformant outputs,
 * ascending); discrepancies rendered prominently.
 *
 * Usage: tsx registry/build-leaderboard.ts [--registry <file>] [--out-dir <dir>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveCostPer1kConformant } from "../src/registry/build";
import type { Registry, RegistryEntry } from "../src/registry/build";

const DEFAULT_REGISTRY = join(__dirname, "registry.json");
const DEFAULT_OUT_DIR = __dirname;

export interface LeaderboardRow {
  readonly model_key: string;
  readonly conform_rate: number | null;
  readonly conform_ci95: readonly [number, number] | null;
  readonly value_accuracy_mean: number | null;
  readonly native_rung_rate: number | null;
  readonly effective_usd_per_1k_conformant: number | null;
  readonly grounded_rate: number | null;
  readonly cache_hit_rate: number | null;
  readonly samples: number;
  readonly as_of: string | null;
  readonly discrepancies: ReadonlyArray<{ kind: string; message: string }>;
}

export function toLeaderboardRows(registry: Registry): LeaderboardRow[] {
  const rows = registry.models.map((entry: RegistryEntry): LeaderboardRow => {
    const schema = entry.probed?.schema ?? null;
    return {
      model_key: entry.model_key,
      conform_rate: schema?.conform_rate ?? null,
      conform_ci95: schema?.conform_ci95 ?? null,
      value_accuracy_mean: schema?.value_accuracy_mean ?? null,
      native_rung_rate: schema?.native_rung_rate ?? null,
      effective_usd_per_1k_conformant: effectiveCostPer1kConformant(schema),
      grounded_rate: entry.probed?.grounding?.grounded_rate ?? null,
      cache_hit_rate: entry.probed?.caching?.cache_hit_rate ?? null,
      samples: schema?.samples ?? 0,
      as_of: entry.probed?.as_of ?? null,
      discrepancies: [...entry.discrepancies],
    };
  });
  // Rank: probed models first by effective cost ascending; unprobed last.
  return rows.sort((a, b) => {
    const costA = a.effective_usd_per_1k_conformant;
    const costB = b.effective_usd_per_1k_conformant;
    if (costA === null && costB === null) return a.model_key < b.model_key ? -1 : 1;
    if (costA === null) return 1;
    if (costB === null) return -1;
    return costA - costB;
  });
}

function pct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(0)}%`;
}

function money(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(3)}`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderLeaderboardHtml(registry: Registry, rows: readonly LeaderboardRow[]): string {
  const bodyRows = rows
    .map((row) => {
      const badges = row.discrepancies
        .map(
          (d) =>
            `<span class="badge" title="${escapeHtml(d.message)}">⚠ ${escapeHtml(d.kind)}</span>`
        )
        .join(" ");
      const ci = row.conform_ci95
        ? ` <span class="ci">[${pct(row.conform_ci95[0])}–${pct(row.conform_ci95[1])}]</span>`
        : "";
      return (
        `<tr><td class="model">${escapeHtml(row.model_key)}${badges ? `<div class="badges">${badges}</div>` : ""}</td>` +
        `<td>${pct(row.conform_rate)}${ci}</td>` +
        `<td>${pct(row.value_accuracy_mean)}</td>` +
        `<td>${money(row.effective_usd_per_1k_conformant)}</td>` +
        `<td>${pct(row.grounded_rate)}</td>` +
        `<td>${pct(row.cache_hit_rate)}</td>` +
        `<td>${row.samples}</td></tr>`
      );
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ModelRig Leaderboard — probed model capabilities</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem auto; max-width: 72rem; padding: 0 1rem; }
  h1 { font-size: 1.4rem; } .sub { color: #777; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #8884; }
  th { font-weight: 600; } .model { font-family: ui-monospace, monospace; }
  .badge { display: inline-block; background: #b4540a22; color: #b4540a; border: 1px solid #b4540a55;
           border-radius: 4px; padding: 0 0.4rem; font-size: 0.75rem; margin-top: 0.25rem; }
  .ci { color: #888; font-size: 0.8rem; }
  footer { margin-top: 2rem; color: #777; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>ModelRig Leaderboard</h1>
<p class="sub">Probed, dated, reproducible capability facts — sampled statistics with 95% confidence
intervals, never single-shot verdicts. Ranked by effective cost per 1,000 schema-conformant outputs.
Reproduce any row: <code>npx modelrig-probes run --model &lt;model&gt;</code>. ⚠ badges mark
declared-vs-probed discrepancies.</p>
<table>
<thead><tr><th>Model</th><th>Schema conformance</th><th>Value accuracy</th>
<th>$ / 1K conformant</th><th>Grounded</th><th>Cache hits</th><th>Samples</th></tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>
<footer>Generated ${escapeHtml(registry.generated_at)} · data ${escapeHtml(registry.license)} ·
probe code Apache-2.0 · <a href="https://github.com/modelrig/modelrig">github.com/modelrig/modelrig</a></footer>
</body>
</html>
`;
}

function main(): void {
  const args = process.argv.slice(2);
  let registryPath = DEFAULT_REGISTRY;
  let outDir = DEFAULT_OUT_DIR;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--registry") registryPath = args[++i];
    else if (args[i] === "--out-dir") outDir = args[++i];
  }

  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as Registry;
  const rows = toLeaderboardRows(registry);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "leaderboard.json"), `${JSON.stringify(rows, null, 2)}\n`);
  writeFileSync(join(outDir, "leaderboard.html"), renderLeaderboardHtml(registry, rows));
  console.log(`leaderboard: ${rows.length} rows → ${join(outDir, "leaderboard.{json,html}")}`);
}

if (require.main === module) main();
