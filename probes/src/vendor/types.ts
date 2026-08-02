/**
 * Vendored caller contracts — post-C2 patch P2 (self-contained probe runner).
 * The probe suite talks to providers through this narrow surface instead of
 * the (closed-core) modelrig package, so `run` is externally reproducible
 * with nothing but this repo and your own API keys.
 *
 * The shape deliberately mirrors the slice of ModelRig's ProviderAdapter the
 * probes exercised: one call, static capability answers, typed-ish failure
 * class strings matching the ModelRig taxonomy (so result files stay
 * comparable across harness versions).
 */

export type ProbeProviderId = "gemini" | "openai" | "deepseek";

/** The two capability facts probe sampling branches on. */
export type ProbeCapability = "structured_native" | "grounded_native";

export interface ProbeCallRequest {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** JSON Schema for native structured output; null => plain/coached path. */
  readonly outputSchema: object | null;
  readonly timeoutMs: number;
  /** Provider-native web grounding (gemini googleSearch). */
  readonly grounding?: boolean;
}

export interface ProbeUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensCached: number;
}

export type ProbeCallResult =
  | { readonly ok: true; readonly text: string; readonly usage: ProbeUsage }
  | { readonly ok: false; readonly failureClass: string; readonly message: string };

export interface ProbeCaller {
  readonly provider: ProbeProviderId;
  readonly model: string;
  supports(capability: ProbeCapability): boolean;
  call(req: ProbeCallRequest): Promise<ProbeCallResult>;
}
