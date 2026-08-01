/**
 * Result file IO — results/<provider>-<model>/<class>-<date>.json (plan WS2).
 * Model keys contain "/", so the directory name flattens it to "-".
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProbeResult } from "./types";

export function resultPath(outDir: string, result: ProbeResult): string {
  const modelDir = result.modelKey.replace(/[^A-Za-z0-9._-]/g, "-");
  const day = result.date.slice(0, 10);
  return join(outDir, modelDir, `${result.class}-${day}.json`);
}

export function writeResult(outDir: string, result: ProbeResult): string {
  const path = resultPath(outDir, result);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  return path;
}

export function readResult(path: string): ProbeResult {
  return JSON.parse(readFileSync(path, "utf8")) as ProbeResult;
}
