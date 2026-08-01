/**
 * Layer-2 live probe check (plan §6): 2 models × schema class, --samples 2,
 * under a $2 envelope. Excluded from CI (vitest --exclude '**\/*.live.test.ts');
 * run manually: MODELRIG_LIVE=1 pnpm --filter modelrig-probes vitest run harness.live
 * Requires real provider keys in the environment.
 */

import { describe, expect, it } from "vitest";
import { loadProbesConfigFromEnv } from "./config";
import { loadFixtures } from "./fixtures";
import { runProbe } from "./harness";

const LIVE_MODELS = ["openai/gpt-4o-mini", "deepseek/deepseek-chat"] as const;

describe.skipIf(process.env.MODELRIG_LIVE !== "1")("live schema probes (budgeted)", () => {
  const config = loadProbesConfigFromEnv();
  const fixtures = loadFixtures("schema");

  for (const modelKey of LIVE_MODELS) {
    it(
      `probes ${modelKey} across the schema corpus within a $2 envelope`,
      { timeout: 600_000 },
      async () => {
        const result = await runProbe(
          { modelKey, samplesPerFixture: 2, envelopeUsd: 2 },
          fixtures,
          config.keys
        );
        expect(result.stats.length).toBe(fixtures.length);
        expect(result.totalCostUsd).toBeLessThan(2);
        for (const stat of result.stats) {
          expect(stat.samples).toBe(2);
          expect(stat.parseRate).toBeGreaterThanOrEqual(0);
        }
      }
    );
  }
});
