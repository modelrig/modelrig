#!/usr/bin/env node
/**
 * modelrig-probes CLI — plan §3:
 *   run --model <provider/model> [--class schema] [--samples N] [--out dir] [--envelope usd]
 *   list-fixtures [--class <class>]
 *   verify <result.json> [--against <published.json>]
 * One-command participation (open-source-strategy §4): run the suite with
 * your own key and reproduce published numbers.
 */

import { loadProbesConfigFromEnv } from "./config";
import { loadFixtures, fixtureHash } from "./fixtures";
import { ProbeBudgetExceededError, runProbe } from "./harness";
import { readResult, writeResult } from "./results";
import { compareResults, verifyResult } from "./verify";
import type { ProbeClass } from "./types";

interface Flags {
  readonly positional: readonly string[];
  readonly named: ReadonlyMap<string, string>;
}

function parseArgs(argv: readonly string[]): Flags {
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`flag ${arg} needs a value`);
      }
      named.set(arg.slice(2), value);
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, named };
}

function parseClass(raw: string | undefined): ProbeClass | undefined {
  if (raw === undefined) return undefined;
  if (raw !== "schema" && raw !== "grounding" && raw !== "caching") {
    throw new Error(`--class must be schema|grounding|caching, got "${raw}"`);
  }
  return raw;
}

async function cmdRun(flags: Flags): Promise<number> {
  const modelKey = flags.named.get("model");
  if (modelKey === undefined) throw new Error("run requires --model <provider/model>");
  const cls = parseClass(flags.named.get("class")) ?? "schema";
  const config = loadProbesConfigFromEnv();
  const samples = flags.named.has("samples") ? Number(flags.named.get("samples")) : config.samplesPerFixture;
  const envelope = flags.named.has("envelope") ? Number(flags.named.get("envelope")) : config.envelopeUsd;
  const outDir = flags.named.get("out") ?? config.outDir;
  if (!Number.isInteger(samples) || samples < 1) throw new Error("--samples must be a positive integer");
  if (!Number.isFinite(envelope) || envelope <= 0) throw new Error("--envelope must be positive");

  const fixtures = loadFixtures(cls);
  if (fixtures.length === 0) throw new Error(`no fixtures for class "${cls}"`);
  console.log(
    `probing ${modelKey} · class=${cls} · ${fixtures.length} fixtures × ${samples} samples · envelope $${envelope}`
  );

  try {
    const result = await runProbe(
      { modelKey, samplesPerFixture: samples, envelopeUsd: envelope },
      fixtures,
      config.keys
    );
    const path = writeResult(outDir, result);
    for (const s of result.stats) {
      const ci = s.conformCi95 ? ` ci95=[${s.conformCi95[0].toFixed(2)},${s.conformCi95[1].toFixed(2)}]` : "";
      console.log(
        `  ${s.fixtureId}: parse=${s.parseRate.toFixed(2)} conform=${s.conformRate?.toFixed(2) ?? "n/a"}${ci} ` +
          `value-acc=${s.valueAccuracyMean?.toFixed(2) ?? "n/a"} $${s.meanCostUsd.toFixed(4)}/sample`
      );
    }
    console.log(`total $${result.totalCostUsd.toFixed(4)} → ${path}`);
    return 0;
  } catch (err) {
    if (err instanceof ProbeBudgetExceededError) {
      const path = writeResult(outDir, err.partial);
      console.error(`${err.message}\npartial result → ${path}`);
      return 2;
    }
    throw err;
  }
}

function cmdListFixtures(flags: Flags): number {
  const cls = parseClass(flags.named.get("class"));
  for (const fixture of loadFixtures(cls)) {
    console.log(`${fixture.class}/${fixture.id}  hash=${fixtureHash(fixture)}  source=${fixture.source}`);
  }
  return 0;
}

function cmdVerify(flags: Flags): number {
  const [file] = flags.positional;
  if (file === undefined) throw new Error("verify requires a result file path");
  const result = readResult(file);

  const integrity = verifyResult(result);
  for (const f of integrity.fixtures) {
    console.log(`${f.fixtureId}: stats ${f.statsMatch ? "MATCH" : "MISMATCH"}`);
  }
  if (!integrity.ok) {
    console.error("integrity check FAILED — recorded stats do not match raw samples");
    return 1;
  }

  const againstPath = flags.named.get("against");
  if (againstPath !== undefined) {
    const published = readResult(againstPath);
    const repro = compareResults(result, published);
    for (const c of repro.checks) {
      if (!c.comparable) {
        console.log(`${c.fixtureId}: not comparable (${c.reason})`);
      } else {
        console.log(
          `${c.fixtureId}: fresh=${c.freshRate?.toFixed(2)} published-ci95=` +
            `[${c.publishedCi95?.[0].toFixed(2)},${c.publishedCi95?.[1].toFixed(2)}] → ` +
            (c.withinCi ? "WITHIN" : "OUTSIDE")
        );
      }
    }
    console.log(repro.ok ? "reproducibility: OK" : "reproducibility: FAILED");
    return repro.ok ? 0 : 1;
  }
  console.log("integrity: OK");
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const flags = parseArgs(rest);
  switch (command) {
    case "run":
      return cmdRun(flags);
    case "list-fixtures":
      return cmdListFixtures(flags);
    case "verify":
      return cmdVerify(flags);
    default:
      console.error(
        "usage: modelrig-probes <run|list-fixtures|verify>\n" +
          "  run --model <provider/model> [--class schema|grounding|caching] [--samples N] [--out dir] [--envelope usd]\n" +
          "  list-fixtures [--class <class>]\n" +
          "  verify <result.json> [--against <published.json>]"
      );
      return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
