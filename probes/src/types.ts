/**
 * Probe suite contracts — Phase 2 spec §2 WS2. Results are sampled statistics
 * with raw per-sample records retained (the honest-stochasticity rule):
 * "reproducible" = an independent rerun lands within the recorded interval.
 */

export type ProbeClass = "schema" | "grounding" | "caching";

export interface ProbeFixture {
  readonly id: string;
  readonly class: ProbeClass;
  /** Task domain (addendum A2): "finance" | "legal" | "technical" |
   * "e-commerce" | "general" | … (open vocabulary, lowercase token).
   * Coverage honesty: the leaderboard and README state the corpus mix, so
   * single-domain results are never presented as domain-general. Metadata
   * only — excluded from the fixture hash (it never reaches the model). */
  readonly domain: string;
  /** Fixture family / corpus provenance (demo-rig spec §11.3b's fourth binding
   * condition): "probe-suite" (the seeded/mined/contributed capability corpus,
   * the default) vs "demo-rig" (the domain-general demo-rig probe tasks). The
   * leaderboard and registry surface which corpus produced a cell, so a model
   * probed only by demo-rig fixtures is visibly that. Metadata only — excluded
   * from the fixture hash (it never reaches the model), so retro-tagging the
   * existing corpus does not invalidate published result hashes. */
  readonly family?: string;
  /** Difficulty tier (discriminating-fixtures plan §3): "standard" (default) |
   * "hard". Orthogonal to `family` — a probe-suite OR a demo-rig fixture can be
   * hard. Like `domain`/`family`, it is CLASSIFICATION metadata that never
   * reaches the model, so it is excluded from the fixture hash: retro-tagging a
   * difficulty must not invalidate published result hashes. */
  readonly difficulty?: "standard" | "hard";
  /** Task subtype (www-clarity §5.5 W16 — Cycle 3's retro-tagging pulled
   * forward): a REAL task-type grouping ("extraction.tabular",
   * "classification", "reasoning.numeric", …), unlike `family` which is
   * corpus provenance. Cross-corpus by design — a demo-rig and a probe-suite
   * fixture can share a subtype. Like the other three, it is CLASSIFICATION
   * metadata that never reaches the model and is excluded from the fixture
   * hash: retro-tagging subtypes must not invalidate published result hashes. */
  readonly subtype?: string;
  /** Free-text authoring note (coverage follow-ups 2026-08-11): why a fixture
   * is in the corpus, e.g. a COVERAGE fixture reinstated after screening found
   * it non-discriminating (saturated). Like the other classification metadata
   * it never reaches the model and is EXCLUDED from the fixture hash, so adding
   * a note to an existing fixture does not invalidate published result hashes. */
  readonly notes?: string;
  /** For schema probes: the JSON schema + input prompt + expected values
   * (value-accuracy keys with known-correct answers). */
  readonly schema?: object;
  readonly prompt: string;
  readonly expectedValues?: Record<string, unknown>;
  /** Provenance: "customer-zero", "litellm-mined:<ref>", "contributed:<name>" */
  readonly source: string;
}

/** The default family for a fixture that does not declare one — the original
 * capability corpus. Kept as a named constant so validation, hashing, and the
 * probed-layer rollup agree on the token. */
export const DEFAULT_FIXTURE_FAMILY = "probe-suite";

/** The default difficulty for a fixture that does not declare one. Kept as a
 * named constant so validation, harness threading, and the by_difficulty
 * rollup agree on the token (discriminating-fixtures plan §3). */
export const DEFAULT_FIXTURE_DIFFICULTY = "standard";

/** The closed vocabulary for `difficulty`. */
export const FIXTURE_DIFFICULTIES = ["standard", "hard"] as const;

export interface ProbeSample {
  /** Which serving rung produced this sample (schema class): native strict
   * enforcement vs schema-in-prompt json_mode coaching. BUILDER ADDITION per
   * the harness scaffold's "record which rung served" directive — flagged in
   * the step-2 session log for architect review. */
  readonly rung?: "native" | "json_mode";
  readonly parseOk: boolean;
  readonly schemaConform: boolean | null; // null when no schema
  readonly valueAccuracy: number | null; // 0..1 fraction of expectedValues matched
  readonly grounded: boolean | null; // grounding class
  readonly citationCount: number | null;
  readonly cachedTokens: number | null; // caching class, second call
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly failureClass: string | null;
}

export interface FixtureStats {
  readonly fixtureId: string;
  readonly samples: number;
  readonly parseRate: number;
  readonly conformRate: number | null;
  readonly valueAccuracyMean: number | null;
  /** Wilson 95% interval bounds on conformRate — the reproducibility contract. */
  readonly conformCi95: readonly [number, number] | null;
  readonly meanCostUsd: number;
}

export interface ProbeResult {
  readonly modelKey: string; // "provider/model"
  readonly class: ProbeClass;
  readonly date: string; // ISO
  readonly harnessVersion: string;
  readonly fixtureHashes: Record<string, string>;
  /** fixtureId → family (demo-rig §11.3b): lets the probed-layer builder split
   * per-corpus stats without re-reading the fixtures. Absent on pre-family
   * result files — consumers default those fixtures to "probe-suite". */
  readonly fixtureFamilies?: Record<string, string>;
  /** fixtureId → difficulty (discriminating-fixtures §3): lets the probed-layer
   * builder split per-difficulty stats without re-reading the fixtures. Absent
   * on pre-difficulty result files — consumers default those to "standard". */
  readonly fixtureDifficulties?: Record<string, string>;
  /** fixtureId → task subtype (www-clarity §5.5 W16): lets the probed-layer
   * builder split per-subtype stats without re-reading the fixtures. Absent on
   * pre-subtype result files AND for untagged fixtures — consumers roll only
   * tagged fixtures into by_subtype (no default bucket). */
  readonly fixtureSubtypes?: Record<string, string>;
  readonly raw: Record<string, readonly ProbeSample[]>; // fixtureId → samples
  readonly stats: readonly FixtureStats[];
  readonly totalCostUsd: number;
}
