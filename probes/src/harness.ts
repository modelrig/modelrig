/**
 * Probe harness — Phase 2 plan §4, made self-contained by post-C2 patch P2:
 * drives vendored direct-API callers (src/vendor/*) — no modelrig dependency,
 * so `run` reproduces externally with this repo + your own keys.
 * N samples per fixture; per-run envelope guard (default $5/model);
 * stats via pure summarize() (unit-tested without network).
 */

import type { ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { probeSampleCostUsd } from "./vendor/pricing";
import type { ProbeCaller } from "./vendor/types";
import { fixtureHash } from "./fixtures";
import { resolveModel } from "./providers";
import { loadProbesConfigFromEnv } from "./config";
import type { ProbesConfig } from "./config";
import { DEFAULT_FIXTURE_DIFFICULTY, DEFAULT_FIXTURE_FAMILY } from "./types";
import type { FixtureStats, ProbeFixture, ProbeResult, ProbeSample } from "./types";
import { createProbeAjv } from "./ajv";

export interface HarnessConfig {
  readonly modelKey: string;
  readonly samplesPerFixture: number; // default 5
  readonly envelopeUsd: number; // default 5
}

/** Typed budget breach — the run stops the moment accrued spend crosses the
 * envelope; everything sampled so far rides along for inspection. */
export class ProbeBudgetExceededError extends Error {
  readonly spentUsd: number;
  readonly envelopeUsd: number;
  readonly partial: ProbeResult;

  constructor(spentUsd: number, envelopeUsd: number, partial: ProbeResult) {
    super(
      `probe envelope exhausted: spent $${spentUsd.toFixed(4)} of $${envelopeUsd.toFixed(2)} — ` +
        `partial results retained (${Object.keys(partial.raw).length} fixtures sampled)`
    );
    this.name = "ProbeBudgetExceededError";
    this.spentUsd = spentUsd;
    this.envelopeUsd = envelopeUsd;
    this.partial = partial;
  }
}

const ajv = createProbeAjv();
const validatorCache = new Map<string, ValidateFunction>();

function validatorFor(fixture: ProbeFixture): ValidateFunction | null {
  if (fixture.schema === undefined) return null;
  const key = fixtureHash(fixture);
  let compiled = validatorCache.get(key);
  if (compiled === undefined) {
    compiled = ajv.compile(fixture.schema);
    validatorCache.set(key, compiled);
  }
  return compiled;
}

/** Strip a single markdown code fence if the whole payload is fenced —
 * json_mode models fence habitually; conformance is judged on the content. */
export function stripFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

/** Dot-path lookup with numeric segments for arrays ("a.items.0.qty"). */
export function valueAtPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const segment of path.split(".")) {
    if (Array.isArray(node)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      node = node[index];
    } else if (typeof node === "object" && node !== null) {
      node = (node as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return node;
}

function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (typeof expected === "number") {
    if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
    const tolerance = Math.max(Math.abs(expected) * 1e-6, 1e-9);
    return Math.abs(actual - expected) <= tolerance;
  }
  if (typeof expected === "string") {
    return typeof actual === "string" && actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return actual === expected;
}

/** Fraction of expectedValues found (0..1), null when none declared. */
export function valueAccuracy(
  parsed: unknown,
  expectedValues: Record<string, unknown> | undefined
): number | null {
  if (expectedValues === undefined) return null;
  const entries = Object.entries(expectedValues);
  if (entries.length === 0) return null;
  const matched = entries.filter(([path, expected]) =>
    valuesMatch(valueAtPath(parsed, path), expected)
  ).length;
  return matched / entries.length;
}

/** Schema-in-prompt coaching for the json_mode rung (mirrors the gateway's
 * coaching so probes measure the same serving path builders get). */
export function jsonModeCoaching(schema: object): string {
  return (
    "\n\n---\nOUTPUT FORMAT (STRICT): Respond with a SINGLE valid JSON object and nothing else — " +
    'no markdown fences, no introductory text. Your response MUST start with "{" and end with "}". ' +
    "The object MUST conform to this JSON Schema — match key names and types EXACTLY, include ALL " +
    "required fields, add no extra fields. Where the schema sets minLength on a prose field, that " +
    `is a FLOOR — comfortably exceed it with real substance:\n\n${JSON.stringify(schema)}`
  );
}

const USER_DIRECTIVE = "Produce the required output now, following the instructions exactly.";

export interface SampleContext {
  readonly caller: ProbeCaller;
}

/** One schema-class sample: dispatch (native rung when the caller declares
 * structured_native, else json_mode coaching), parse, ajv, value-accuracy.
 * Pure aside from the caller dispatch — hermetic tests inject a fake caller. */
export async function runSchemaSample(
  ctx: SampleContext,
  fixture: ProbeFixture
): Promise<ProbeSample> {
  const native = ctx.caller.supports("structured_native");
  const schema = fixture.schema ?? null;
  const systemPrompt =
    native || schema === null ? fixture.prompt : fixture.prompt + jsonModeCoaching(schema);

  const started = Date.now();
  const result = await ctx.caller.call({
    systemPrompt,
    userPrompt: USER_DIRECTIVE,
    outputSchema: native ? schema : null,
    timeoutMs: 180_000,
  });
  const latencyMs = Date.now() - started;

  const rung: ProbeSample["rung"] = native ? "native" : "json_mode";

  if (!result.ok) {
    return {
      parseOk: false,
      schemaConform: schema === null ? null : false,
      valueAccuracy: null,
      grounded: null,
      citationCount: null,
      cachedTokens: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs,
      failureClass: result.failureClass,
      rung,
    };
  }

  const costUsd = probeSampleCostUsd(ctx.caller.provider, ctx.caller.model, result.usage);

  let parsed: unknown;
  let parseOk = true;
  try {
    parsed = JSON.parse(stripFence(result.text));
  } catch {
    parseOk = false;
  }

  let schemaConform: boolean | null = null;
  let accuracy: number | null = null;
  if (schema !== null) {
    const validate = validatorFor(fixture);
    schemaConform = parseOk && validate !== null ? validate(parsed) === true : false;
  }
  if (parseOk) {
    accuracy = valueAccuracy(parsed, fixture.expectedValues);
  }

  return {
    parseOk,
    schemaConform,
    valueAccuracy: accuracy,
    grounded: null,
    citationCount: null,
    cachedTokens: null,
    tokensIn: result.usage.tokensIn,
    tokensOut: result.usage.tokensOut,
    costUsd,
    latencyMs,
    failureClass: null,
    rung,
  };
}

/** Wilson 95% score interval — honest bounds at probe-scale N. */
export function wilson95(successes: number, n: number): readonly [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.959963984540054;
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function summarize(fixtureId: string, samples: readonly ProbeSample[]): FixtureStats {
  const n = samples.length;
  if (n === 0) {
    return {
      fixtureId,
      samples: 0,
      parseRate: 0,
      conformRate: null,
      valueAccuracyMean: null,
      conformCi95: null,
      meanCostUsd: 0,
    };
  }
  const parseRate = samples.filter((s) => s.parseOk).length / n;
  const judged = samples.filter((s) => s.schemaConform !== null);
  const conforming = judged.filter((s) => s.schemaConform === true).length;
  const conformRate = judged.length === 0 ? null : conforming / judged.length;
  const accuracies = samples
    .map((s) => s.valueAccuracy)
    .filter((a): a is number => a !== null);
  const valueAccuracyMean =
    accuracies.length === 0 ? null : accuracies.reduce((a, b) => a + b, 0) / accuracies.length;
  const meanCostUsd = samples.reduce((a, s) => a + s.costUsd, 0) / n;

  return {
    fixtureId,
    samples: n,
    parseRate,
    conformRate,
    valueAccuracyMean,
    conformCi95: judged.length === 0 ? null : wilson95(conforming, judged.length),
    meanCostUsd,
  };
}

function harnessVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8")
  ) as { version: string };
  return pkg.version;
}

export function assembleResult(
  modelKey: string,
  cls: ProbeFixture["class"],
  fixtures: readonly ProbeFixture[],
  raw: Record<string, readonly ProbeSample[]>,
  version: string = harnessVersion()
): ProbeResult {
  const fixtureHashes: Record<string, string> = {};
  const fixtureFamilies: Record<string, string> = {};
  const fixtureDifficulties: Record<string, string> = {};
  // Subtype has NO default: only tagged fixtures join a by_subtype bucket
  // (www-clarity §5.5 W16) — an untagged fixture belongs to no task type.
  const fixtureSubtypes: Record<string, string> = {};
  for (const fixture of fixtures) {
    if (raw[fixture.id] !== undefined) {
      fixtureHashes[fixture.id] = fixtureHash(fixture);
      fixtureFamilies[fixture.id] = fixture.family ?? DEFAULT_FIXTURE_FAMILY;
      fixtureDifficulties[fixture.id] = fixture.difficulty ?? DEFAULT_FIXTURE_DIFFICULTY;
      if (fixture.subtype !== undefined) fixtureSubtypes[fixture.id] = fixture.subtype;
    }
  }
  const stats = Object.entries(raw).map(([id, samples]) => summarize(id, samples));
  const totalCostUsd = Object.values(raw)
    .flat()
    .reduce((a, s) => a + s.costUsd, 0);
  return {
    modelKey,
    class: cls,
    date: new Date().toISOString(),
    harnessVersion: version,
    fixtureHashes,
    fixtureFamilies,
    fixtureDifficulties,
    ...(Object.keys(fixtureSubtypes).length > 0 ? { fixtureSubtypes } : {}),
    raw,
    stats,
    totalCostUsd,
  };
}

export type SampleRunner = (ctx: SampleContext, fixture: ProbeFixture) => Promise<ProbeSample>;

/** Class-agnostic sampling loop with the envelope guard; the per-class
 * sample runner is injected (schema now; grounding/caching in step 3). */
export async function sampleFixtures(
  ctx: SampleContext,
  modelKey: string,
  cls: ProbeFixture["class"],
  fixtures: readonly ProbeFixture[],
  samplesPerFixture: number,
  envelopeUsd: number,
  runner: SampleRunner
): Promise<ProbeResult> {
  const raw: Record<string, ProbeSample[]> = {};
  let spent = 0;
  for (const fixture of fixtures) {
    raw[fixture.id] = [];
    for (let i = 0; i < samplesPerFixture; i += 1) {
      if (spent >= envelopeUsd) {
        throw new ProbeBudgetExceededError(
          spent,
          envelopeUsd,
          assembleResult(modelKey, cls, fixtures, raw)
        );
      }
      const sample = await runner(ctx, fixture);
      raw[fixture.id].push(sample);
      spent += sample.costUsd;
    }
  }
  return assembleResult(modelKey, cls, fixtures, raw);
}

export async function runProbe(
  config: HarnessConfig,
  fixtures: readonly ProbeFixture[],
  keys?: ProbesConfig["keys"]
): Promise<ProbeResult> {
  if (fixtures.length === 0) throw new Error("no fixtures to run");
  const cls = fixtures[0].class;
  if (fixtures.some((f) => f.class !== cls)) {
    throw new Error("runProbe expects fixtures of a single class per invocation");
  }
  // Class runners imported lazily to keep module graphs cycle-free
  // (grounding/caching import SampleContext from this module).
  const runner: SampleRunner =
    cls === "schema"
      ? runSchemaSample
      : cls === "grounding"
        ? (await import("./grounding")).runGroundingSample
        : (await import("./caching")).runCachingSample;
  const resolvedKeys = keys ?? loadProbesConfigFromEnv().keys;
  const caller = resolveModel(config.modelKey, resolvedKeys);
  return sampleFixtures(
    { caller },
    config.modelKey,
    cls,
    fixtures,
    config.samplesPerFixture,
    config.envelopeUsd,
    runner
  );
}
