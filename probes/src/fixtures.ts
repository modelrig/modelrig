/**
 * Fixture loading + hashing. Fixtures are plain JSON files under
 * fixtures/<class>/*.json so contributors can add cases without touching
 * code (probe-kit contract). Hashes are recorded in every result so a rerun
 * can prove it exercised the same inputs.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProbeClass, ProbeFixture } from "./types";

const FIXTURES_ROOT = join(__dirname, "..", "fixtures");
const CLASSES: readonly ProbeClass[] = ["schema", "grounding", "caching"];

/** Deterministic serialization: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hash covers the model-relevant fixture content. `domain` (A2) is
 * classification metadata that never reaches the model, so it is excluded —
 * retro-tagging the corpus must NOT invalidate published result hashes
 * (the reproducibility contract compares hashes across runs). */
export function fixtureHash(fixture: ProbeFixture): string {
  const { domain: _domain, ...hashed } = fixture;
  return createHash("sha256").update(canonicalJson(hashed)).digest("hex").slice(0, 16);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseFixture(raw: unknown, file: string): ProbeFixture {
  if (!isRecord(raw)) throw new Error(`fixture ${file}: must be a JSON object`);
  const { id, prompt, source } = raw;
  const cls = raw.class;
  if (typeof id !== "string" || id === "") throw new Error(`fixture ${file}: id required`);
  if (typeof cls !== "string" || !CLASSES.includes(cls as ProbeClass)) {
    throw new Error(`fixture ${file}: class must be one of [${CLASSES.join(", ")}]`);
  }
  if (typeof prompt !== "string" || prompt === "") throw new Error(`fixture ${file}: prompt required`);
  if (typeof source !== "string" || source === "") throw new Error(`fixture ${file}: source required`);
  if (typeof raw.domain !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(raw.domain)) {
    throw new Error(
      `fixture ${file}: domain required (lowercase token, e.g. finance|legal|technical|e-commerce|general)`
    );
  }
  if (raw.schema !== undefined && !isRecord(raw.schema)) {
    throw new Error(`fixture ${file}: schema must be an object when present`);
  }
  if (raw.expectedValues !== undefined && !isRecord(raw.expectedValues)) {
    throw new Error(`fixture ${file}: expectedValues must be an object when present`);
  }
  return {
    id,
    class: cls as ProbeClass,
    domain: raw.domain,
    ...(raw.schema !== undefined ? { schema: raw.schema as object } : {}),
    prompt,
    ...(raw.expectedValues !== undefined
      ? { expectedValues: raw.expectedValues as Record<string, unknown> }
      : {}),
    source,
  };
}

export function loadFixtures(cls?: ProbeClass, root: string = FIXTURES_ROOT): ProbeFixture[] {
  const classes = cls !== undefined ? [cls] : CLASSES;
  const fixtures: ProbeFixture[] = [];
  const seen = new Set<string>();
  for (const c of classes) {
    const dir = join(root, c);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const fixture = parseFixture(
        JSON.parse(readFileSync(join(dir, file), "utf8")) as unknown,
        `${c}/${file}`
      );
      if (fixture.class !== c) {
        throw new Error(`fixture ${c}/${file}: declares class "${fixture.class}" but lives in ${c}/`);
      }
      if (seen.has(fixture.id)) throw new Error(`duplicate fixture id "${fixture.id}"`);
      seen.add(fixture.id);
      fixtures.push(fixture);
    }
  }
  return fixtures;
}
