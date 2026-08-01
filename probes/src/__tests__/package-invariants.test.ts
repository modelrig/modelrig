/**
 * Package-boundary invariants for modelrig-probes — the same rules the core
 * package enforces (extended per the Phase 2 mission brief):
 *  1. No imports from the closed workspace scopes — this package publishes
 *     to the public modelrig/modelrig repo; the boundary must hold by test.
 *     (Needles assembled at runtime so this file passes its own scan AND the
 *     publish script's leak-grep.)
 *  2. No process.env reads outside src/config.ts.
 *  3. No source file exceeds 700 LOC (standing decision 4).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(__dirname, "..");

function sourceFiles(dir: string = SRC_ROOT): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function codeLines(file: string): Array<{ line: string; n: number }> {
  let inBlock = false;
  return readFileSync(file, "utf8")
    .split("\n")
    .map((raw, i) => {
      let line = raw;
      if (inBlock) {
        const end = line.indexOf("*/");
        if (end === -1) return { line: "", n: i + 1 };
        line = line.slice(end + 2);
        inBlock = false;
      }
      const start = line.indexOf("/*");
      if (start !== -1 && !line.includes("*/", start)) {
        line = line.slice(0, start);
        inBlock = true;
      }
      const slashes = line.indexOf("//");
      if (slashes !== -1) line = line.slice(0, slashes);
      return { line, n: i + 1 };
    });
}

describe("package invariants (modelrig-probes)", () => {
  const files = sourceFiles();

  it("never imports from the closed workspace scopes", () => {
    // Runtime-assembled needles: "@" + scope and the apps/ path prefix.
    const scopeNeedle = ["@", "inferwealth", "/"].join("");
    const importPattern = new RegExp(
      `from\\s+["'](${scopeNeedle}|(\\.\\./)*apps/)`
    );
    const requirePattern = new RegExp(`require\\(["']${scopeNeedle}`);
    const offenders: string[] = [];
    for (const file of files) {
      for (const { line, n } of codeLines(file)) {
        if (importPattern.test(line) || requirePattern.test(line)) {
          offenders.push(`${relative(SRC_ROOT, file)}:${n}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads the process environment only in src/config.ts", () => {
    const envNeedle = ["process", "env"].join(".");
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(SRC_ROOT, file);
      if (rel === "config.ts" || rel.endsWith(".live.test.ts")) continue;
      for (const { line, n } of codeLines(file)) {
        if (line.includes(envNeedle)) offenders.push(`${rel}:${n}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps every source file at or under 700 LOC", () => {
    const offenders = files
      .map((f) => ({ f: relative(SRC_ROOT, f), loc: readFileSync(f, "utf8").split("\n").length }))
      .filter(({ loc }) => loc > 700);
    expect(offenders).toEqual([]);
  });
});
