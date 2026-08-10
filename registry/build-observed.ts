/**
 * Observed-layer generator — spec WS3: derived BY QUERY from routed
 * telemetry (per model: served-tier rates, p50 latency, cache-hit rate,
 * failure-class rates). Computed, not hand-maintained.
 *
 * PRIVACY (plan §10, reviewed at step 4): the query selects ONLY
 * operational columns — provider, model, served_tier, latency_ms,
 * tokens_cached, failure_class. No tags, no payloads, no fingerprints.
 *
 * Env (script-level, not part of the src/ config rule): MODELRIG_SUPABASE_URL
 * + MODELRIG_SUPABASE_PUBLISHABLE_KEY — anon read-only, by design: this script
 * needs nothing beyond what RLS grants every console reader.
 *
 * Usage: tsx registry/build-observed.ts [--out <file>]
 * Output: registry/layers/observed.json  { [model_key]: ObservedLayer }
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ObservedLayer } from "../src/registry/build";
import { computePercentiles, DEFAULT_HEALTH_MIN_N, percentile } from "../src/telemetry/health";

const DEFAULT_OUT = join(__dirname, "layers", "observed.json");

interface ObservedRow {
  readonly provider: string;
  readonly model: string;
  readonly served_tier: string;
  readonly latency_ms: number;
  readonly tokens_cached: number;
  readonly failure_class: string | null;
  /** TTFB (Phase 4 WS3) — null for rows recorded before the column existed. */
  readonly ttfb_ms?: number | null;
}

export function aggregateObserved(
  rows: readonly ObservedRow[],
  asOf: string,
  // Health percentiles/error-rate below this sample count surface as null — the
  // same min-n gate the live store reader applies (observed-health/spec §4.1).
  minN: number = DEFAULT_HEALTH_MIN_N
): Record<string, ObservedLayer> {
  const byModel = new Map<string, ObservedRow[]>();
  for (const row of rows) {
    const key = `${row.provider}/${row.model}`;
    const list = byModel.get(key) ?? [];
    list.push(row);
    byModel.set(key, list);
  }

  const out: Record<string, ObservedLayer> = {};
  for (const [key, modelRows] of [...byModel.entries()].sort()) {
    const n = modelRows.length;
    const tierCounts: Record<string, number> = {};
    const failureCounts: Record<string, number> = {};
    for (const row of modelRows) {
      tierCounts[row.served_tier] = (tierCounts[row.served_tier] ?? 0) + 1;
      if (row.failure_class !== null) {
        failureCounts[row.failure_class] = (failureCounts[row.failure_class] ?? 0) + 1;
      }
    }
    const latencies = modelRows
      .map((r) => r.latency_ms)
      .filter((l) => l > 0)
      .sort((a, b) => a - b);
    const ttfbs = modelRows
      .map((r) => r.ttfb_ms ?? null)
      .filter((t): t is number => t !== null && t > 0)
      .sort((a, b) => a - b);
    // G-4 health percentiles + error-rate, gated below min-n. p50_* stay
    // ungated for backward compatibility with existing observed layers; the new
    // health fields are additive and the console health block reads them.
    const gated = n < minN;
    const latencyPcts = gated ? null : computePercentiles(latencies);
    const ttfbPcts = gated ? null : computePercentiles(ttfbs);
    const errorCount = Object.values(failureCounts).reduce((sum, c) => sum + c, 0);
    out[key] = {
      as_of: asOf,
      source: "routed-telemetry",
      inferences: n,
      p50_latency_ms: percentile(latencies, 50),
      p50_ttfb_ms: percentile(ttfbs, 50),
      p90_latency_ms: latencyPcts?.p90 ?? null,
      p99_latency_ms: latencyPcts?.p99 ?? null,
      p90_ttfb_ms: ttfbPcts?.p90 ?? null,
      p99_ttfb_ms: ttfbPcts?.p99 ?? null,
      error_rate: gated ? null : errorCount / n,
      sample_n: n,
      served_tier_rates: Object.fromEntries(
        Object.entries(tierCounts).map(([tier, count]) => [tier, count / n])
      ),
      cache_hit_rate: n === 0 ? null : modelRows.filter((r) => r.tokens_cached > 0).length / n,
      failure_class_rates: Object.fromEntries(
        Object.entries(failureCounts).map(([cls, count]) => [cls, count / n])
      ),
    };
  }
  return out;
}

async function fetchRows(supabaseUrl: string, anonKey: string): Promise<ObservedRow[]> {
  const rows: ObservedRow[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const url =
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/inferences` +
      `?select=provider,model,served_tier,latency_ms,ttfb_ms,tokens_cached,failure_class` +
      `&order=ts.desc&limit=${pageSize}&offset=${offset}`;
    const response = await fetch(url, {
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    });
    if (!response.ok) {
      throw new Error(`observed query failed: ${response.status} ${await response.text()}`);
    }
    const page = (await response.json()) as ObservedRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let out = DEFAULT_OUT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--out") out = args[++i];
  }
  const supabaseUrl = process.env.MODELRIG_SUPABASE_URL;
  const anonKey = process.env.MODELRIG_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("MODELRIG_SUPABASE_URL and MODELRIG_SUPABASE_PUBLISHABLE_KEY are required");
  }
  const rows = await fetchRows(supabaseUrl, anonKey);
  const layers = aggregateObserved(rows, new Date().toISOString());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(layers, null, 2)}\n`);
  console.log(`observed layer: ${Object.keys(layers).length} models from ${rows.length} inferences → ${out}`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
