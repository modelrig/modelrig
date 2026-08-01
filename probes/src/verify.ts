/**
 * Result verification — the reproducibility helper (plan §3).
 * `verifyResult` recomputes stats from the raw per-sample records and checks
 * the recorded stats block matches (integrity: nobody edited the summary).
 * `compareResults` checks a fresh rerun's conformance rate against a
 * published result's Wilson interval (reproducibility: spec WS2's
 * honest-stochasticity contract).
 */

import { summarize } from "./harness";
import type { FixtureStats, ProbeResult } from "./types";

const RATE_EPSILON = 1e-9;

function ratesEqual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= RATE_EPSILON;
}

function ciEqual(
  a: readonly [number, number] | null,
  b: readonly [number, number] | null
): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a[0] - b[0]) <= RATE_EPSILON && Math.abs(a[1] - b[1]) <= RATE_EPSILON;
}

export interface FixtureVerification {
  readonly fixtureId: string;
  readonly statsMatch: boolean;
  readonly recorded: FixtureStats | null;
  readonly recomputed: FixtureStats;
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly fixtures: readonly FixtureVerification[];
}

export function verifyResult(result: ProbeResult): VerifyReport {
  const recordedById = new Map(result.stats.map((s) => [s.fixtureId, s]));
  const fixtures: FixtureVerification[] = Object.entries(result.raw).map(([id, samples]) => {
    const recomputed = summarize(id, samples);
    const recorded = recordedById.get(id) ?? null;
    const statsMatch =
      recorded !== null &&
      recorded.samples === recomputed.samples &&
      ratesEqual(recorded.parseRate, recomputed.parseRate) &&
      ratesEqual(recorded.conformRate, recomputed.conformRate) &&
      ratesEqual(recorded.valueAccuracyMean, recomputed.valueAccuracyMean) &&
      ciEqual(recorded.conformCi95, recomputed.conformCi95);
    return { fixtureId: id, statsMatch, recorded, recomputed };
  });
  return { ok: fixtures.every((f) => f.statsMatch), fixtures };
}

export interface ReproducibilityCheck {
  readonly fixtureId: string;
  /** null when either side lacks a judged conformance rate or the fixture
   * hashes differ (not comparable). */
  readonly comparable: boolean;
  readonly reason: string | null;
  readonly freshRate: number | null;
  readonly publishedCi95: readonly [number, number] | null;
  readonly withinCi: boolean | null;
}

export interface ReproducibilityReport {
  readonly ok: boolean;
  readonly checks: readonly ReproducibilityCheck[];
}

/** Fresh rerun vs published result: same harness + same fixture hashes ⇒
 * the fresh conformance rate must land inside the published 95% interval. */
export function compareResults(fresh: ProbeResult, published: ProbeResult): ReproducibilityReport {
  const publishedStats = new Map(published.stats.map((s) => [s.fixtureId, s]));
  const checks: ReproducibilityCheck[] = fresh.stats.map((freshStat) => {
    const id = freshStat.fixtureId;
    const pub = publishedStats.get(id);
    if (pub === undefined) {
      return {
        fixtureId: id,
        comparable: false,
        reason: "fixture not present in published result",
        freshRate: freshStat.conformRate,
        publishedCi95: null,
        withinCi: null,
      };
    }
    if (fresh.fixtureHashes[id] !== published.fixtureHashes[id]) {
      return {
        fixtureId: id,
        comparable: false,
        reason: "fixture hash differs — inputs changed between runs",
        freshRate: freshStat.conformRate,
        publishedCi95: pub.conformCi95,
        withinCi: null,
      };
    }
    if (freshStat.conformRate === null || pub.conformCi95 === null) {
      return {
        fixtureId: id,
        comparable: false,
        reason: "no judged conformance rate on one side",
        freshRate: freshStat.conformRate,
        publishedCi95: pub.conformCi95,
        withinCi: null,
      };
    }
    const [low, high] = pub.conformCi95;
    const within = freshStat.conformRate >= low && freshStat.conformRate <= high;
    return {
      fixtureId: id,
      comparable: true,
      reason: null,
      freshRate: freshStat.conformRate,
      publishedCi95: pub.conformCi95,
      withinCi: within,
    };
  });
  const comparable = checks.filter((c) => c.comparable);
  return {
    ok: comparable.length > 0 && comparable.every((c) => c.withinCi === true),
    checks,
  };
}
