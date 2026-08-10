/**
 * Leaderboard static generator — spec WS3: registry.json → leaderboard.html
 * (for modelrig.dev) + leaderboard.json (data consumers). Ranked by
 * "conformance per dollar" (effective $ per 1K conformant outputs,
 * ascending); discrepancies rendered prominently.
 *
 * Usage: tsx registry/build-leaderboard.ts [--registry <file>] [--out-dir <dir>]
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveCostPer1kConformant } from "../src/registry/build";
import type { ProbedFamilySummary, Registry, RegistryEntry } from "../src/registry/build";
import { computeParity, assertParityCoverageSane } from "../src/registry/parity";
import type { ParityListEntry } from "../src/registry/parity";
import { probeFreshness, stalenessSentence, PROBE_FRESHNESS_SLO_DAYS } from "../src/registry/staleness";

const DEFAULT_REGISTRY = join(__dirname, "registry.json");
const DEFAULT_OUT_DIR = __dirname;
const FIXTURES_DIR = join(__dirname, "..", "..", "modelrig-probes", "fixtures");

/** Coverage honesty (addendum A2 + demo-rig §11.3b): the corpus size, its
 * fixture families, and the per-class domain mix are stated on every render,
 * computed from the fixtures on disk — never a hand-written adjective — so the
 * note always describes the corpus it actually has. */
export function corpusSummary(fixturesDir: string = FIXTURES_DIR): string {
  const perClass: string[] = [];
  const families = new Map<string, number>();
  const domainsAll = new Map<string, number>();
  let total = 0;
  for (const cls of ["schema", "grounding", "caching"]) {
    const dir = join(fixturesDir, cls);
    if (!existsSync(dir)) continue;
    const domains = new Map<string, number>();
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        domain?: string;
        family?: string;
      };
      const domain = fixture.domain ?? "untagged";
      const family = fixture.family ?? "probe-suite";
      domains.set(domain, (domains.get(domain) ?? 0) + 1);
      domainsAll.set(domain, (domainsAll.get(domain) ?? 0) + 1);
      families.set(family, (families.get(family) ?? 0) + 1);
      total += 1;
    }
    const mix = [...domains.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([domain, count]) => `${count} ${domain}`)
      .join(", ");
    perClass.push(`${cls}: ${mix}`);
  }
  const familyMix = [...families.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([family, count]) => `${count} ${family}`)
    .join(", ");
  const financeShare = domainsAll.get("finance") ?? 0;
  const weighting =
    total > 0 && financeShare / total >= 0.5
      ? "finance-weighted (seeded from our first production customer)"
      : "mixed-domain (a finance-seeded probe-suite plus a domain-general demo-rig family)";
  return (
    `${total} fixtures, ${weighting}, in ${families.size} families (${familyMix}) — ` +
    `${perClass.join(" · ")}. The demo-rig family is authored synthetic / public-domain tasks ` +
    `(example.support_summarize, invoice.extract, docs.qa, content.classify) with deterministic ground ` +
    `truth — strong for capability ranking, and explicitly not a claim about any customer's workload.`
  );
}

/** Min samples a per-family cell needs before its rates are shown rather than
 * gated to `null` (task-type-leaderboards spec §2.1). A "some small N" floor in
 * the DEFAULT_HEALTH_MIN_N style — kept local (not imported from telemetry) so
 * the family/subtype granularity can be tuned independently of the observed-
 * health gate. Below it the `value_accuracy_mean`/`conform_rate`/effective cost
 * are `null` (surfaced as "—"); `samples` is retained so a reader sees WHY it is
 * gated ("n=8, too few"), never a confident-looking number on thin evidence. */
export const FAMILY_MIN_N = 10;

/** Per-family rollup on a leaderboard row (task-type-leaderboards spec §2.1) —
 * the same shape of numbers as the flat columns, sliced by fixture family, so a
 * "who's best at <family>?" view can re-rank on `value_accuracy_mean` and
 * tie-break on `effective_usd_per_1k_conformant`. A DESCRIPTIVE marginal
 * statistic, never a RigIndex rank (spec §1 honesty boundary). */
export interface LeaderboardFamilyStats {
  /** Samples this family contributed — always the true count (never nulled), so
   * a gated cell can explain itself ("n below the floor"). */
  readonly samples: number;
  /** `null` when `samples < FAMILY_MIN_N` (min-n gate) or no sample was judged. */
  readonly conform_rate: number | null;
  /** `null` when `samples < FAMILY_MIN_N` (min-n gate) or no value was scored. */
  readonly value_accuracy_mean: number | null;
  /** Serving path of this family's samples (native strict vs json_mode coaching)
   * — passes through the probed sub-summary; not min-n gated (it is a mix ratio,
   * not a rate whose CI the floor protects). `null` when no rung was recorded. */
  readonly native_rung_rate: number | null;
  /** Effective cost of conformance for THIS family: mean per-sample cost /
   * conform_rate × 1000. `null` when gated, when conform_rate is 0/null, or when
   * the probed layer predates per-family `mean_cost_usd` (graceful degradation
   * — the cost column simply shows "—" until the next rebuild populates it). */
  readonly effective_usd_per_1k_conformant: number | null;
}

export interface LeaderboardRow {
  readonly model_key: string;
  readonly conform_rate: number | null;
  readonly conform_ci95: readonly [number, number] | null;
  readonly value_accuracy_mean: number | null;
  readonly native_rung_rate: number | null;
  /** Conformance / value-accuracy on the HARD subset only
   * (discriminating-fixtures §3) — the differentiating column. Null when the
   * model has no hard-tier samples (pre-difficulty result, or none reached). */
  readonly hard_conform_rate: number | null;
  readonly hard_value_accuracy_mean: number | null;
  readonly hard_samples: number;
  /** Serving path the HARD subset was probed through (follow-up 3a): the
   * fraction served via the native structured rung vs json_mode coaching. Lets
   * a hard miss read "coached, missed" rather than a flat fail — a model without
   * probed structured_native is coached on every sample. Null when no hard
   * sample recorded a rung. */
  readonly hard_native_rung_rate: number | null;
  readonly effective_usd_per_1k_conformant: number | null;
  readonly grounded_rate: number | null;
  readonly cache_hit_rate: number | null;
  readonly samples: number;
  readonly as_of: string | null;
  /** Which fixture families produced this row's schema samples (demo-rig
   * §11.3b) — a model probed only by demo-rig is visibly that. */
  readonly families: readonly string[];
  /** How many schema samples each family contributed — `{ family: count }`
   * (probe-cycle-001 contract addition, consumed by leaderboard-legibility
   * §4). Lets a reader see "8 authored demo fixtures vs 30 field probes" where
   * `samples` alone reports only the total. Always present; `{}` when unprobed,
   * mirroring `families: []`. Keys always equal `families`. */
  readonly fixture_counts: Readonly<Record<string, number>>;
  /** Per-family measured accuracy + cost (task-type-leaderboards spec §2.1),
   * min-n gated. Present only when the probed schema layer carries a `by_family`
   * rollup; absent (undefined) for legacy/unprobed rows so the www consumer
   * degrades gracefully. Keys are the same families as `families`. These are
   * DESCRIPTIVE marginal stats for the task-type views — not a RigIndex rank. */
  readonly by_family?: Readonly<Record<string, LeaderboardFamilyStats>>;
  readonly discrepancies: ReadonlyArray<{ kind: string; message: string }>;
}

/** Effective cost of conformance for one per-family sub-summary — the same
 * formula `effectiveCostPer1kConformant` applies to the aggregate, at family
 * granularity. `null` unless we have a positive conform_rate AND a per-family
 * `mean_cost_usd` (absent on pre–task-type probed layers → graceful "—"). */
function familyEffectiveCost(family: ProbedFamilySummary): number | null {
  if (family.mean_cost_usd === undefined) return null;
  if (family.conform_rate === null || family.conform_rate === 0) return null;
  return (family.mean_cost_usd / family.conform_rate) * 1000;
}

/** Roll the probed `by_family` map into the leaderboard's per-family view,
 * applying the min-n gate (spec §2.1): below FAMILY_MIN_N the rate fields go
 * `null` (kept honest as "—"), but `samples` and the derived cost stay
 * computable-from-what-remains. Returns undefined when the schema carries no
 * `by_family` (legacy/unprobed) so the field is simply omitted from the row. */
function familyRollup(
  byFamily: Readonly<Record<string, ProbedFamilySummary>> | undefined
): Record<string, LeaderboardFamilyStats> | undefined {
  if (byFamily === undefined) return undefined;
  const out: Record<string, LeaderboardFamilyStats> = {};
  for (const [family, stats] of Object.entries(byFamily)) {
    const gated = stats.samples < FAMILY_MIN_N;
    const conform_rate = gated ? null : stats.conform_rate;
    out[family] = {
      samples: stats.samples,
      conform_rate,
      value_accuracy_mean: gated ? null : stats.value_accuracy_mean,
      native_rung_rate: stats.native_rung_rate,
      // Cost uses the gated conform_rate: a gated family shows no cost either,
      // so a "—" accuracy is never paired with a confident-looking price.
      effective_usd_per_1k_conformant: gated ? null : familyEffectiveCost(stats),
    };
  }
  return out;
}

export function toLeaderboardRows(registry: Registry): LeaderboardRow[] {
  const rows = registry.models.map((entry: RegistryEntry): LeaderboardRow => {
    const schema = entry.probed?.schema ?? null;
    const hard = schema?.by_difficulty?.["hard"] ?? null;
    const by_family = familyRollup(schema?.by_family);
    return {
      model_key: entry.model_key,
      conform_rate: schema?.conform_rate ?? null,
      conform_ci95: schema?.conform_ci95 ?? null,
      value_accuracy_mean: schema?.value_accuracy_mean ?? null,
      native_rung_rate: schema?.native_rung_rate ?? null,
      hard_conform_rate: hard?.conform_rate ?? null,
      hard_value_accuracy_mean: hard?.value_accuracy_mean ?? null,
      hard_samples: hard?.samples ?? 0,
      hard_native_rung_rate: hard?.native_rung_rate ?? null,
      effective_usd_per_1k_conformant: effectiveCostPer1kConformant(schema),
      grounded_rate: entry.probed?.grounding?.grounded_rate ?? null,
      cache_hit_rate: entry.probed?.caching?.cache_hit_rate ?? null,
      samples: schema?.samples ?? 0,
      as_of: entry.probed?.as_of ?? null,
      families: schema?.by_family ? Object.keys(schema.by_family).sort() : [],
      fixture_counts: schema?.by_family
        ? Object.fromEntries(
            Object.entries(schema.by_family).map(([family, stats]) => [family, stats.samples])
          )
        : {},
      ...(by_family ? { by_family } : {}),
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

/**
 * The serving-path label rendered beside a hard-subset cell (follow-up 3a):
 * did the model serve these strict fixtures through its NATIVE structured rung,
 * or through json_mode coaching? A json_mode model that misses a strict
 * constraint read as a flat fail before this — now it reads "coached, missed",
 * which is the honest interpretation (the miss is the coaching path's limit).
 * Labeling only: every model still runs every fixture; nothing is excluded.
 */
export function servingPathLabel(nativeRungRate: number | null): string | null {
  if (nativeRungRate === null) return null;
  if (nativeRungRate >= 0.99) return "native";
  if (nativeRungRate <= 0.01) return "coached";
  return `mixed · ${(nativeRungRate * 100).toFixed(0)}% native`;
}

/** Which corpora produced a row's schema numbers (demo-rig §11.3b). A model
 * probed only by demo-rig fixtures is labeled as such — never silently mixed
 * with probe-suite rows. "—" when unprobed on the schema class. */
function corpusCell(families: readonly string[]): string {
  if (families.length === 0) return "—";
  if (families.length === 1 && families[0] === "demo-rig") {
    return `<span class="badge">demo-rig only</span>`;
  }
  return escapeHtml(families.join(" + "));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** parity-50 section (addendum A1, provider-coverage-plan §3): probed
 * coverage of the top-50-by-usage yardstick, unprobed gaps NAMED — an
 * unprobed model is labeled, never invisible. */
export function parityHtml(registry: Registry): string {
  const parityPath = join(__dirname, "parity-50.json");
  if (!existsSync(parityPath)) return "";
  const list = JSON.parse(readFileSync(parityPath, "utf8")) as {
    as_of: string;
    source: string;
    models: ParityListEntry[];
  };
  const parity = computeParity(list.models, registry);
  const gaps =
    parity.gaps.length === 0
      ? ""
      : `<div class="badges">${parity.gaps
          .map((g) => `<span class="badge">${escapeHtml(g.name)} — ${escapeHtml(g.status)}</span>`)
          .join(" ")}</div>`;
  return (
    `<p class="sub"><strong>parity-50:</strong> ${parity.probed}/${parity.total} of the ` +
    `top-by-usage yardstick (<a href="${escapeHtml(list.source)}">source</a>, as of ` +
    `${escapeHtml(list.as_of)}) are PROBED — ${(parity.probedPct * 100).toFixed(0)}%. ` +
    `Their coverage is declared; ours is verified — and our gaps are named, not hidden:</p>` +
    gaps
  );
}

export function renderLeaderboardHtml(
  registry: Registry,
  rows: readonly LeaderboardRow[],
  now: Date = new Date()
): string {
  // A2: never serve stale-as-fresh. Rendered visible when stale at
  // generation; the inline script re-checks age at VIEW time (a fresh page
  // read months later must still banner).
  const freshness = probeFreshness(rows.map((r) => r.as_of), now);
  const bannerAttrs = freshness.stale ? "" : " hidden";
  const banner =
    `<div id="staleness-banner"${bannerAttrs} data-newest-as-of="${escapeHtml(freshness.newestAsOf ?? "")}" ` +
    `data-slo-days="${PROBE_FRESHNESS_SLO_DAYS}" class="staleness">` +
    `${escapeHtml(stalenessSentence(freshness))}</div>`;
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
      const servingPath = servingPathLabel(row.hard_native_rung_rate);
      const pathTag =
        servingPath === null
          ? ""
          : ` <span class="path path-${servingPath === "native" ? "native" : "coached"}" ` +
            `title="Serving path the hard fixtures were probed through — a coached miss is the ` +
            `json_mode path's limit, not a native strict failure">${escapeHtml(servingPath)}</span>`;
      const hardCell =
        row.hard_samples === 0
          ? "—"
          : `${pct(row.hard_conform_rate)} <span class="ci">(acc ${pct(row.hard_value_accuracy_mean)}, n=${row.hard_samples})</span>${pathTag}`;
      return (
        `<tr><td class="model">${escapeHtml(row.model_key)}${badges ? `<div class="badges">${badges}</div>` : ""}</td>` +
        `<td>${pct(row.conform_rate)}${ci}</td>` +
        `<td>${hardCell}</td>` +
        `<td>${pct(row.value_accuracy_mean)}</td>` +
        `<td>${money(row.effective_usd_per_1k_conformant)}</td>` +
        `<td>${pct(row.grounded_rate)}</td>` +
        `<td>${pct(row.cache_hit_rate)}</td>` +
        `<td>${row.samples}</td>` +
        `<td>${corpusCell(row.families)}</td></tr>`
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
  .path { display: inline-block; border-radius: 4px; padding: 0 0.35rem; font-size: 0.7rem; margin-left: 0.25rem; }
  .path-native { background: #2e7d3222; color: #2e7d32; border: 1px solid #2e7d3255; }
  .path-coached { background: #6a5acd22; color: #6a5acd; border: 1px solid #6a5acd55; }
  .staleness { background: #E5A63C22; border: 1px solid #E5A63C; color: #b07818;
               border-radius: 6px; padding: 0.6rem 0.9rem; margin-bottom: 1rem; font-size: 0.9rem; }
  footer { margin-top: 2rem; color: #777; font-size: 0.8rem; }
</style>
</head>
<body>
<h1>ModelRig Leaderboard</h1>
${banner}
<script>
  // A2: re-check freshness with the viewer's clock (static page, live SLO).
  (function () {
    var el = document.getElementById("staleness-banner");
    if (!el || !el.hidden) return;
    var asOf = Date.parse(el.getAttribute("data-newest-as-of") || "");
    var sloDays = Number(el.getAttribute("data-slo-days") || "31");
    if (!isFinite(asOf)) return;
    var daysOld = Math.floor((Date.now() - asOf) / 86400000);
    if (daysOld > sloDays) {
      el.textContent = "This probe data exceeded its freshness window (" + sloDays +
        " days): newest result " + new Date(asOf).toISOString().slice(0, 10) + ", " +
        daysOld + " days old. The data below is still shown, clearly dated — a rerun is due.";
      el.hidden = false;
    }
  })();
</script>
<p class="sub">Probed, dated, reproducible capability facts — sampled statistics with 95% confidence
intervals, never single-shot verdicts. Ranked by effective cost per 1,000 schema-conformant outputs.
Reproduce any row: <code>npx modelrig-probes run --model &lt;model&gt;</code>. ⚠ badges mark
declared-vs-probed discrepancies.</p>
<p class="sub"><strong>Coverage:</strong> ${escapeHtml(corpusSummary())} Per-fixture stats (with
domains and families) are in each published result file; the rates in this table aggregate the whole
schema corpus, and the <strong>Corpus</strong> column names which families produced each row — a model
probed only by demo-rig fixtures is marked so, never mixed silently. The <strong>Hard conf.</strong>
column is conformance on the authored hard-tier subset — the same fixtures for every model — where
capable models separate; the aggregate stays the ranking basis. A <span class="path path-native">native</span>
or <span class="path path-coached">coached</span> tag beside it names the serving path those strict
fixtures were probed through: a model without probed <code>structured_native</code> is coached via
json_mode, so a coached miss is that path's limit — read "coached, missed", not a flat fail. Every
model still runs every fixture; the tag labels, it never excludes. <strong>The probe-kit's headline
ask is fixtures from your domain</strong> —
<a href="https://github.com/modelrig/modelrig/tree/main/kits/probe-kit">contribute one</a>.</p>
${parityHtml(registry)}
<table>
<thead><tr><th>Model</th><th>Schema conformance</th><th title="Conformance on the hard-tier fixture subset — the differentiating column">Hard conf.</th><th>Value accuracy</th>
<th>$ / 1K conformant</th><th>Grounded</th><th>Cache hits</th><th>Samples</th><th>Corpus</th></tr></thead>
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
  // Mechanical zero-coverage gate: if the parity list ↔ registry join collapses
  // to 0 while real probed data exists, fail the build instead of publishing a
  // false 0% coverage (see src/registry/parity.ts). The parity-coverage.gate
  // test asserts the same on the committed data so CI catches it before deploy.
  const parityPath = join(__dirname, "parity-50.json");
  if (existsSync(parityPath)) {
    const list = JSON.parse(readFileSync(parityPath, "utf8")) as { models: ParityListEntry[] };
    assertParityCoverageSane(computeParity(list.models, registry), registry);
  }
  const rows = toLeaderboardRows(registry);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "leaderboard.json"), `${JSON.stringify(rows, null, 2)}\n`);
  writeFileSync(join(outDir, "leaderboard.html"), renderLeaderboardHtml(registry, rows));
  console.log(`leaderboard: ${rows.length} rows → ${join(outDir, "leaderboard.{json,html}")}`);
}

if (require.main === module) main();
