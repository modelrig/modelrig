/**
 * Model-key resolution: "provider/model" → a live ProviderAdapter plus a
 * legitimately-minted CandidateRef. Probes bypass ROUTING, never the brand:
 * the ref is minted by modelrig's resolveCandidates — the single sanctioned
 * brand site — against a synthetic single-candidate probe route.
 */

import {
  createDeepSeekAdapter,
  createGeminiAdapter,
  createOpenAIAdapter,
  resolveCandidates,
} from "modelrig";
import type { CandidateRef, ProviderAdapter, ProviderId, RouteBundle } from "modelrig";
import type { ProbesConfig } from "./config";

const SUPPORTED_PROVIDERS: ReadonlySet<string> = new Set(["gemini", "openai", "deepseek"]);

export interface ResolvedModel {
  readonly provider: ProviderId;
  readonly model: string;
  readonly adapter: ProviderAdapter;
  readonly candidate: CandidateRef;
}

export function parseModelKey(modelKey: string): { provider: ProviderId; model: string } {
  const slash = modelKey.indexOf("/");
  if (slash <= 0 || slash === modelKey.length - 1) {
    throw new Error(`model key "${modelKey}" must be "provider/model" (e.g. "openai/gpt-5.2")`);
  }
  const provider = modelKey.slice(0, slash);
  const model = modelKey.slice(slash + 1);
  if (!SUPPORTED_PROVIDERS.has(provider)) {
    throw new Error(
      `provider "${provider}" is not supported by the probe harness — ` +
        `known providers: [${[...SUPPORTED_PROVIDERS].join(", ")}]`
    );
  }
  return { provider: provider as ProviderId, model };
}

function probeRoute(provider: ProviderId, model: string): RouteBundle {
  return {
    route: `probe.${provider}.${model}`,
    version: 1,
    outputSchema: null,
    candidates: [{ provider, model }],
    require: [],
    prefer: [],
    systemTemplate: "",
    variables: [],
    policy: { retries: {}, timeoutMs: 180_000, tier: "standard", json: "native" },
    fingerprintCell: null,
  };
}

export function resolveModel(modelKey: string, keys: ProbesConfig["keys"]): ResolvedModel {
  const { provider, model } = parseModelKey(modelKey);

  let adapter: ProviderAdapter;
  switch (provider) {
    case "gemini":
      if (!keys.gemini) throw new Error("GEMINI_API_KEY is not set");
      adapter = createGeminiAdapter({ apiKey: keys.gemini });
      break;
    case "openai":
      if (!keys.openai) throw new Error("OPENAI_API_KEY is not set");
      adapter = createOpenAIAdapter({ apiKey: keys.openai });
      break;
    case "deepseek":
      if (!keys.deepseek) throw new Error("DEEPSEEK_API_KEY is not set");
      adapter = createDeepSeekAdapter({ apiKey: keys.deepseek });
      break;
    default:
      throw new Error(`unreachable provider "${provider as string}"`);
  }

  // require:[] means every declared candidate is eligible regardless of
  // capability flags, so an empty lookup suffices to mint the ref.
  const iter = resolveCandidates(probeRoute(provider, model), () => new Set(), () => null);
  const candidate = iter.next();
  if (candidate === null) {
    throw new Error(`could not resolve a candidate for "${modelKey}"`);
  }
  return { provider, model, adapter, candidate };
}
