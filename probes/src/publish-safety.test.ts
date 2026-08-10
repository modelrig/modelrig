import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What `npm publish` would put on the internet — G2, extended to modelrig-probes
 * per A-WS3.1.
 *
 * This package is DESTINED for the public modelrig/modelrig repo, so the guard
 * matters most here. Without a `files` allowlist, `npm pack` shipped `src/`,
 * `tsconfig.json`, and the `fixtures/` + `results/` corpora — build inputs and
 * recorded runs, not the package — and any future `.env` would fall through the
 * same npm-fallback gap that put 13 secrets in `modelrig`'s pack. Asserts on the
 * manifest npm actually computes. Runs in the default `pnpm test` — a release
 * GATE, not a nicety.
 */
const pkgDir = resolve(__dirname, "..");

function packedFiles(): string[] {
  const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: pkgDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const report = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
  return report[0].files.map((f) => f.path);
}

const files = packedFiles();

describe("modelrig-probes publish safety (G2 / A-WS3.1)", () => {
  it("ships no environment file", () => {
    const env = files.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith(".env.example"));
    expect(env, `env files in the tarball: ${env.join(", ")}`).toEqual([]);
  });

  it("ships no file whose contents look like a credential", () => {
    const secretish = new RegExp(
      [
        "sk-[A-Za-z0-9]{20,}",
        "AIza[A-Za-z0-9_-]{30,}",
        "rig_sk_[A-Za-z0-9]{16,}",
        "rnd_[A-Za-z0-9]{20,}",
        "eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}",
        "(KEY|TOKEN|SECRET)\\s*[=:]\\s*[\"']?[A-Za-z0-9_-]{24,}",
      ].join("|"),
    );
    const offenders: string[] = [];
    for (const file of files) {
      if (!/\.(js|ts|json|md|txt|ya?ml|env.*)$/.test(file)) continue;
      let body: string;
      try {
        body = readFileSync(join(pkgDir, file), "utf8");
      } catch {
        continue;
      }
      if (secretish.test(body)) offenders.push(file);
    }
    expect(offenders, `possible credentials in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("ships neither the fixtures/results corpora nor tsconfig", () => {
    const corpora = files.filter((f) => /^(fixtures|results)\//.test(f) || f === "tsconfig.json");
    expect(corpora, `build inputs in the tarball: ${corpora.slice(0, 5).join(", ")}`).toEqual([]);
  });

  it("ships nothing outside the allowlist (dist + package.json)", () => {
    const stray = files.filter((f) => !/^dist\//.test(f) && f !== "package.json");
    expect(stray, `outside dist/: ${stray.join(", ")}`).toEqual([]);
  });

  it("ships no test or source file — dist only", () => {
    expect(files.filter((f) => /\.test\.[jt]s$/.test(f))).toEqual([]);
    expect(files.filter((f) => f.startsWith("src/"))).toEqual([]);
  });

  it("still ships the package's entry and CLI", () => {
    expect(files).toContain("dist/index.js");
    expect(files).toContain("dist/cli.js");
    expect(files).toContain("package.json");
  });
});
