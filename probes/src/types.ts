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
  /** For schema probes: the JSON schema + input prompt + expected values
   * (value-accuracy keys with known-correct answers). */
  readonly schema?: object;
  readonly prompt: string;
  readonly expectedValues?: Record<string, unknown>;
  /** Provenance: "customer-zero", "litellm-mined:<ref>", "contributed:<name>" */
  readonly source: string;
}

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
  readonly raw: Record<string, readonly ProbeSample[]>; // fixtureId → samples
  readonly stats: readonly FixtureStats[];
  readonly totalCostUsd: number;
}
