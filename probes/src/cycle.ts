/**
 * Probe-cycle orchestrator — the recurring monthly fan-out (demo-rig §11.3b).
 * One cycle fans every fixture across every reachable, priced model, scores it,
 * and writes result files the registry pipeline consumes. Built so cycle 002 is
 * a cron away: generate a plan, estimate its cost, run it under a hard ceiling.
 *
 * Binding rules enforced here (each an existing doctrine):
 *  - Same inputs, same criteria, every model — a model runs the WHOLE class
 *    corpus or is recorded skipped; never a per-model fixture subset.
 *  - Fail-closed on unpriced models (dev-rule P6) — a model with no pricing-map
 *    entry is SKIPPED and named, never run at phantom-zero cost. The harness
 *    costs unpriced samples at $0, so running one would both mis-measure spend
 *    and evade the envelope; the cycle refuses.
 *  - Hard ceiling — cumulative spend is capped by cycleCeilingUsd through the
 *    same ProbeBudgetExceededError machinery; a runaway cycle hard-stops.
 *  - Partial cycles record as partial — a model not reached is "not yet probed
 *    this cycle", never last cycle's number carried forward.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadFixtures } from "./fixtures";
import { ProbeBudgetExceededError, jsonModeCoaching, runProbe } from "./harness";
import { parseModelKey } from "./providers";
import { writeResult } from "./results";
import { getProbePricing, estimateProbeCostUsd } from "./vendor/pricing";
import type { ProbesConfig } from "./config";
import type { ProbeClass, ProbeResult } from "./types";

/** A class run whose samples are mostly HARNESS-side failures (network,
 * timeout, capacity_shed) is not a valid capability measurement — those count
 * as non-conformance and would defame the model. Above this failure rate the
 * cycle retries once and, if still bad, refuses to publish the result over
 * whatever prior-good data exists (the manifest still records the attempt). */
const CONTAMINATION_THRESHOLD = 0.5;

/** Fraction of samples that carry a failureClass (harness/provider errors). */
export function failureRateOf(result: ProbeResult): number {
  const samples = Object.values(result.raw).flat();
  if (samples.length === 0) return 1;
  return samples.filter((s) => s.failureClass !== null).length / samples.length;
}

export interface CycleJob {
  readonly modelKey: string;
  readonly classes: readonly ProbeClass[];
}

export interface CyclePlan {
  readonly cycle: string;
  readonly samples: number;
  /** Per-model spend ceiling (the tier-2 campaign's ~$2-5/model anchor). */
  readonly perModelEnvelopeUsd: number;
  /** Whole-cycle hard ceiling — the $25 budget. */
  readonly cycleCeilingUsd: number;
  readonly jobs: readonly CycleJob[];
}

/** Conservative per-class output-token assumptions for the pre-run estimate.
 * The estimate only needs to be honest enough to prove the cycle is nowhere
 * near the ceiling; the envelope is the real enforcement. */
const ASSUMED_OUTPUT_TOKENS: Record<ProbeClass, number> = {
  schema: 350,
  grounding: 700,
  caching: 350,
};
/** Calls per sample by class (caching does a cold + warm call). */
const CALLS_PER_SAMPLE: Record<ProbeClass, number> = { schema: 1, grounding: 1, caching: 2 };

function estimateTokensIn(promptChars: number): number {
  return Math.ceil(promptChars / 4);
}

export interface ClassCostEstimate {
  readonly cls: ProbeClass;
  readonly fixtures: number;
  readonly samples: number;
  readonly usd: number;
}

export interface ModelCostEstimate {
  readonly modelKey: string;
  readonly priced: boolean;
  readonly reachable: boolean;
  readonly classes: readonly ClassCostEstimate[];
  readonly usd: number;
  readonly skipReason?: "unpriced" | "no-key";
}

export interface CycleEstimate {
  readonly cycle: string;
  readonly perModel: readonly ModelCostEstimate[];
  /** Sum over priced + reachable models — the number to report before running. */
  readonly projectedUsd: number;
  readonly pricedReachableModels: number;
  readonly unpriced: readonly string[];
  readonly unreachable: readonly string[];
  readonly cycleCeilingUsd: number;
}

/** Project cycle cost from the registry pricing map — reported BEFORE any
 * spend (mission gate; anything approaching the ceiling means stop and say so).
 * Unpriced and unreachable models contribute $0 and are named, not hidden. */
export function estimateCycleCost(plan: CyclePlan, keys: ProbesConfig["keys"]): CycleEstimate {
  const fixturesByClass = new Map<ProbeClass, ReturnType<typeof loadFixtures>>();
  const perModel: ModelCostEstimate[] = [];
  const unpriced: string[] = [];
  const unreachable: string[] = [];
  let projectedUsd = 0;
  let pricedReachableModels = 0;

  for (const job of plan.jobs) {
    const { provider, model } = parseModelKey(job.modelKey);
    const reachable = Boolean(keys[provider]);
    const pricing = getProbePricing(provider, model);
    const priced = pricing !== null;

    if (!reachable) {
      unreachable.push(job.modelKey);
      perModel.push({ modelKey: job.modelKey, priced, reachable, classes: [], usd: 0, skipReason: "no-key" });
      continue;
    }
    if (!priced) {
      unpriced.push(job.modelKey);
      perModel.push({ modelKey: job.modelKey, priced, reachable, classes: [], usd: 0, skipReason: "unpriced" });
      continue;
    }

    const classes: ClassCostEstimate[] = [];
    let modelUsd = 0;
    for (const cls of job.classes) {
      let fixtures = fixturesByClass.get(cls);
      if (fixtures === undefined) {
        fixtures = loadFixtures(cls);
        fixturesByClass.set(cls, fixtures);
      }
      const outTokens = ASSUMED_OUTPUT_TOKENS[cls];
      const calls = CALLS_PER_SAMPLE[cls];
      let clsUsd = 0;
      for (const fixture of fixtures) {
        const coachingChars = fixture.schema ? jsonModeCoaching(fixture.schema).length : 0;
        const inTokens = estimateTokensIn(fixture.prompt.length + coachingChars);
        const perSample = estimateProbeCostUsd(pricing, inTokens, outTokens, 0) * calls;
        clsUsd += perSample * plan.samples;
      }
      classes.push({ cls, fixtures: fixtures.length, samples: fixtures.length * plan.samples, usd: clsUsd });
      modelUsd += clsUsd;
    }
    perModel.push({ modelKey: job.modelKey, priced, reachable, classes, usd: modelUsd });
    projectedUsd += modelUsd;
    pricedReachableModels += 1;
  }

  return {
    cycle: plan.cycle,
    perModel,
    projectedUsd,
    pricedReachableModels,
    unpriced,
    unreachable,
    cycleCeilingUsd: plan.cycleCeilingUsd,
  };
}

export type ModelCycleStatus =
  | "probed"
  | "partial"
  | "contaminated"
  | "skipped-unpriced"
  | "skipped-unreachable"
  | "not-probed-this-cycle"
  | "failed";

export interface ClassRunRecord {
  readonly cls: ProbeClass;
  readonly status: "probed" | "partial" | "contaminated" | "failed";
  readonly samples: number;
  readonly costUsd: number;
  /** Fraction of samples that were harness/provider failures (0..1). */
  readonly failureRate?: number;
  readonly resultPath?: string;
  readonly error?: string;
}

export interface ModelCycleRecord {
  readonly modelKey: string;
  readonly status: ModelCycleStatus;
  readonly classes: readonly ClassRunRecord[];
  readonly costUsd: number;
  readonly note?: string;
}

export interface CycleManifest {
  readonly cycle: string;
  readonly date: string;
  readonly samples: number;
  readonly cycleCeilingUsd: number;
  readonly projectedUsd: number | null;
  readonly totalSpentUsd: number;
  readonly ceilingReached: boolean;
  readonly counts: Readonly<Record<ModelCycleStatus, number>>;
  readonly models: readonly ModelCycleRecord[];
}

export interface RunCycleOptions {
  readonly outDir: string;
  readonly keys: ProbesConfig["keys"];
  readonly projectedUsd?: number;
  /** Injectable for hermetic tests; defaults to the real network runProbe. */
  readonly runProbeImpl?: typeof runProbe;
  readonly now?: () => Date;
}

/** Execute the cycle under the hard ceiling. Never throws for a single model's
 * failure — every model lands in the manifest with an honest status. */
export async function runCycle(plan: CyclePlan, opts: RunCycleOptions): Promise<CycleManifest> {
  const runImpl = opts.runProbeImpl ?? runProbe;
  const now = opts.now ?? ((): Date => new Date());
  const models: ModelCycleRecord[] = [];
  let spent = 0;
  let ceilingReached = false;

  for (const job of plan.jobs) {
    const { provider, model } = parseModelKey(job.modelKey);

    if (ceilingReached) {
      models.push({ modelKey: job.modelKey, status: "not-probed-this-cycle", classes: [], costUsd: 0,
        note: "cycle ceiling reached before this model" });
      continue;
    }
    if (!opts.keys[provider]) {
      models.push({ modelKey: job.modelKey, status: "skipped-unreachable", classes: [], costUsd: 0,
        note: `no API key for provider "${provider}"` });
      continue;
    }
    if (getProbePricing(provider, model) === null) {
      // Fail-closed (P6): no price ⇒ do not run at phantom-zero cost.
      models.push({ modelKey: job.modelKey, status: "skipped-unpriced", classes: [], costUsd: 0,
        note: "no pricing-map entry — fail-closed, not probed this cycle" });
      continue;
    }
    if (plan.cycleCeilingUsd - spent <= 0) {
      ceilingReached = true;
      models.push({ modelKey: job.modelKey, status: "not-probed-this-cycle", classes: [], costUsd: 0,
        note: "cycle ceiling reached before this model" });
      continue;
    }

    const classRecords: ClassRunRecord[] = [];
    let modelSpent = 0;
    let modelPartial = false;
    for (const cls of job.classes) {
      const remainingTotal = plan.cycleCeilingUsd - spent;
      if (remainingTotal <= 0) {
        ceilingReached = true;
        break;
      }
      const envelope = Math.min(plan.perModelEnvelopeUsd - modelSpent, remainingTotal);
      if (envelope <= 0) break;
      const fixtures = loadFixtures(cls);
      if (fixtures.length === 0) continue;
      try {
        const cfg = { modelKey: job.modelKey, samplesPerFixture: plan.samples, envelopeUsd: envelope };
        let result = await runImpl(cfg, fixtures, opts.keys);
        spent += result.totalCostUsd;
        modelSpent += result.totalCostUsd;
        // Retry once if the run is mostly harness/provider failures (transient
        // network/rate-limit) — recover a real measurement rather than publish
        // an infra failure as the model's 0%. Failed samples cost ~$0.
        if (failureRateOf(result) > CONTAMINATION_THRESHOLD) {
          const retry = await runImpl(cfg, fixtures, opts.keys);
          spent += retry.totalCostUsd;
          modelSpent += retry.totalCostUsd;
          if (failureRateOf(retry) < failureRateOf(result)) result = retry;
        }
        const fr = failureRateOf(result);
        const sampleCount = Object.values(result.raw).reduce((a, s) => a + s.length, 0);
        if (fr > CONTAMINATION_THRESHOLD) {
          // Still contaminated — do NOT publish over prior-good data; the
          // manifest records the attempt so a human/cron can see it and re-run.
          classRecords.push({ cls, status: "contaminated", samples: sampleCount, costUsd: result.totalCostUsd, failureRate: fr });
        } else {
          const path = writeResult(opts.outDir, result);
          classRecords.push({ cls, status: "probed", samples: sampleCount, costUsd: result.totalCostUsd, failureRate: fr, resultPath: path });
        }
      } catch (err) {
        if (err instanceof ProbeBudgetExceededError) {
          const path = writeResult(opts.outDir, err.partial);
          spent += err.partial.totalCostUsd;
          modelSpent += err.partial.totalCostUsd;
          const sampleCount = Object.values(err.partial.raw).reduce((a, s) => a + s.length, 0);
          classRecords.push({ cls, status: "partial", samples: sampleCount, costUsd: err.partial.totalCostUsd, resultPath: path });
          modelPartial = true;
          ceilingReached = true;
          break;
        }
        classRecords.push({ cls, status: "failed", samples: 0, costUsd: 0,
          error: err instanceof Error ? err.message : String(err) });
      }
    }

    const anyProbed = classRecords.some((c) => c.status === "probed");
    const anyDegraded = classRecords.some((c) => c.status === "failed" || c.status === "contaminated");
    const allContaminated =
      classRecords.length > 0 && classRecords.every((c) => c.status === "contaminated");
    const status: ModelCycleStatus = modelPartial
      ? "partial"
      : anyProbed
        ? anyDegraded
          ? "partial"
          : "probed"
        : allContaminated
          ? "contaminated"
          : classRecords.length === 0 && ceilingReached
            ? "not-probed-this-cycle"
            : "failed";
    models.push({ modelKey: job.modelKey, status, classes: classRecords, costUsd: modelSpent });
  }

  const counts = {
    probed: 0,
    partial: 0,
    contaminated: 0,
    "skipped-unpriced": 0,
    "skipped-unreachable": 0,
    "not-probed-this-cycle": 0,
    failed: 0,
  } as Record<ModelCycleStatus, number>;
  for (const m of models) counts[m.status] += 1;

  return {
    cycle: plan.cycle,
    date: now().toISOString(),
    samples: plan.samples,
    cycleCeilingUsd: plan.cycleCeilingUsd,
    projectedUsd: opts.projectedUsd ?? null,
    totalSpentUsd: spent,
    ceilingReached,
    counts,
    models,
  };
}

/** Model keys that already have result files (existing probed models) — they
 * re-run this cycle so the demo-rig family fills their schema cells too, from
 * the same corpus in the same run. */
export function modelKeysFromResults(resultsDir: string): string[] {
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
        const parsed = JSON.parse(readFileSync(join(resultsDir, dir, file), "utf8")) as { modelKey?: string };
        if (typeof parsed.modelKey === "string") keys.add(parsed.modelKey);
      } catch {
        // skip
      }
    }
  }
  return [...keys].sort();
}

interface CampaignFile {
  readonly targets?: ReadonlyArray<{ readonly provider: string; readonly model: string }>;
}

/** Tier-2 (or any) campaign targets → "provider/model" keys. */
export function modelKeysFromCampaign(campaignPath: string): string[] {
  if (!existsSync(campaignPath)) return [];
  const parsed = JSON.parse(readFileSync(campaignPath, "utf8")) as CampaignFile;
  return (parsed.targets ?? []).map((t) => `${t.provider}/${t.model}`);
}

export interface BuildPlanOptions {
  readonly cycle: string;
  readonly resultsDir?: string;
  readonly campaignPath?: string;
  readonly samples: number;
  readonly perModelEnvelopeUsd: number;
  readonly cycleCeilingUsd: number;
  /** Classes existing (already-probed) models re-run — schema by default, so
   * they pick up the demo-rig family without re-paying for grounding/caching. */
  readonly existingClasses?: readonly ProbeClass[];
  /** Classes new campaign models run — the full 3-class cycle by default. */
  readonly newClasses?: readonly ProbeClass[];
}

/** Assemble a cycle plan from the existing registry (results dir) + a campaign.
 * Existing models re-run `existingClasses`; new campaign models run
 * `newClasses`. This is what makes cycle 002 a regeneration, not a rewrite. */
export function buildCyclePlan(opts: BuildPlanOptions): CyclePlan {
  const existing = opts.resultsDir ? modelKeysFromResults(opts.resultsDir) : [];
  const campaign = opts.campaignPath ? modelKeysFromCampaign(opts.campaignPath) : [];
  const existingSet = new Set(existing);
  const existingClasses = opts.existingClasses ?? (["schema"] as const);
  const newClasses = opts.newClasses ?? (["schema", "grounding", "caching"] as const);

  const jobs: CycleJob[] = [];
  const seen = new Set<string>();
  for (const key of existing) {
    jobs.push({ modelKey: key, classes: [...existingClasses] });
    seen.add(key);
  }
  for (const key of campaign) {
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push({ modelKey: key, classes: existingSet.has(key) ? [...existingClasses] : [...newClasses] });
  }
  jobs.sort((a, b) => (a.modelKey < b.modelKey ? -1 : 1));
  return {
    cycle: opts.cycle,
    samples: opts.samples,
    perModelEnvelopeUsd: opts.perModelEnvelopeUsd,
    cycleCeilingUsd: opts.cycleCeilingUsd,
    jobs,
  };
}
