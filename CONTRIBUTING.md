# Contributing to ModelRig

Thanks for helping make model capability data honest. This document covers the
two things every contributor should know: **what's open here**, and **how to
get a change merged**.

## What this repository is (and isn't)

Open in this repo:

- **`probes/`** — the probe suite (Apache-2.0). Empirical capability
  verification: schema conformance (parses ≠ conforms ≠ values-correct),
  grounding, caching.
- **`registry/`** — the registry data and its builders. Data files are
  **CC BY 4.0** (see `registry/LICENSE`); build scripts are Apache-2.0.
- **`docs/`** — the documentation source for modelrig.dev.
- **`kits/`** — contribution kits (probe kit, adapter kit).

Not in this repo, by design: the hosted console, the observed-traffic layer
beyond published aggregates, repair orchestration, billing, and anything
derived from customer traffic. We state this plainly so nobody feels baited:
the boundary is *interfaces and measurement instruments open; aggregated
operational data and money rails closed*.

## How results work (two-tier trust)

Community-submitted probe results are marked **reported** until our
infrastructure reruns them, at which point they become **verified**. Every
result file carries its harness version, fixture hashes, and raw per-sample
records so anyone can recompute the stats:

```bash
npx modelrig-probes run --model openai/gpt-5.2 --class schema
npx modelrig-probes verify results/openai-gpt-5.2/schema-<date>.json --against <published>.json
```

Probe results are **sampled statistics, never single-shot verdicts** — a
"reproduction" means your rerun lands within the published 95% confidence
interval. If your numbers disagree with published data, that disagreement is
itself a contribution: open an issue with your result file attached.

## Contributing a probe fixture

1. Copy `kits/probe-kit/fixture-template.json`.
2. Set `source` to `contributed:<your-github-handle>` — credit lands on the
   leaderboard.
3. Add the fixture under `probes/fixtures/<class>/`.
4. Run the suite against at least one model and include the result in your PR.

## Contributing an adapter

The probe suite IS the adapter contract test: your adapter ships when it
passes the probes. See `kits/adapter-kit/README.md`.

## Developer Certificate of Origin (DCO)

We use the [DCO](https://developercertificate.org/) instead of a CLA. Sign off
every commit (`git commit -s`), which adds:

```
Signed-off-by: Your Name <your@email.example>
```

By signing off you certify you have the right to submit the work under this
repository's licenses (Apache-2.0 for code, CC BY 4.0 for registry data).

## Code standards

- TypeScript, strict; no `any`.
- Tests colocated (`*.test.ts`); live-key tests as `*.live.test.ts` (excluded
  from CI).
- Files ≤ ~700 lines.
