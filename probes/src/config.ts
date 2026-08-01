/**
 * Probes configuration — THE ONLY FILE that reads process.env in this package
 * (enforced by __tests__/package-invariants.test.ts, same rule as the core).
 */

export interface ProbesConfig {
  readonly keys: {
    readonly gemini?: string;
    readonly openai?: string;
    readonly deepseek?: string;
  };
  /** Per-run spend ceiling — spec WS2 default $5/model. */
  readonly envelopeUsd: number;
  readonly samplesPerFixture: number;
  readonly outDir: string;
}

export const DEFAULT_ENVELOPE_USD = 5;
export const DEFAULT_SAMPLES = 5;
export const DEFAULT_OUT_DIR = "results";

export function loadProbesConfigFromEnv(overrides?: Partial<ProbesConfig>): ProbesConfig {
  const env = process.env;
  const envelopeRaw = env.MODELRIG_PROBES_ENVELOPE_USD;
  const envelope = envelopeRaw !== undefined && envelopeRaw !== "" ? Number(envelopeRaw) : undefined;

  const fromEnv: ProbesConfig = {
    keys: {
      ...(env.GEMINI_API_KEY ? { gemini: env.GEMINI_API_KEY } : {}),
      ...(env.OPENAI_API_KEY ? { openai: env.OPENAI_API_KEY } : {}),
      ...(env.DEEPSEEK_API_KEY ? { deepseek: env.DEEPSEEK_API_KEY } : {}),
    },
    envelopeUsd: envelope !== undefined && Number.isFinite(envelope) ? envelope : DEFAULT_ENVELOPE_USD,
    samplesPerFixture: DEFAULT_SAMPLES,
    outDir: DEFAULT_OUT_DIR,
  };

  return {
    ...fromEnv,
    ...overrides,
    keys: { ...fromEnv.keys, ...overrides?.keys },
  };
}
