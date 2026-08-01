# Adapter kit

A provider without an adapter isn't routable. If you run or use an inference
host that ModelRig doesn't cover, contributing the adapter gets it covered —
and probed, which puts it on the leaderboard.

## The contract

An adapter implements the `ProviderAdapter` interface from the `modelrig`
package:

```ts
interface ProviderAdapter {
  readonly id: ProviderId;
  supports(feature: CapabilityFlag, model: string): boolean;
  call(req: AdapterRequest): Promise<AdapterResult>;
}
```

Rules that keep adapters honest and portable:

- **Transformation logic only.** No logging frameworks, no cost tables
  (pricing belongs to the registry), no environment reads (keys arrive via
  the constructor).
- **Typed failures.** Map provider errors onto the `RigFailure` taxonomy
  (`capacity_shed`, `network`, `refusal`, `content_invalid`, …) — never throw
  raw provider exceptions across the boundary.
- **Report real usage.** `tokensIn/tokensOut/tokensCached` and the served
  tier must come from the provider response, not estimates, wherever the API
  reports them.

## The quality gate

**The probe suite is the adapter contract test.** Your adapter ships when the
three probe classes run green against at least one real model behind it:

```bash
npx modelrig-probes run --model <your-provider>/<model> --class schema
npx modelrig-probes run --model <your-provider>/<model> --class grounding
npx modelrig-probes run --model <your-provider>/<model> --class caching
```

Attach the result files to your PR. Adapter credit lands in the registry
entry for every model your adapter serves.

This kit is a skeleton in Phase 2 — a worked example adapter lands with the
first external contribution or the Phase 3 emulation work, whichever comes
first.
