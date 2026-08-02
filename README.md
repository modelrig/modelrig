# ModelRig

**The capability-aware AI gateway. Rig it. Prove it. Sell it.**

Every AI gateway tells you which models *claim* to support structured outputs,
grounding, or caching. ModelRig **probes** them — continuously, empirically,
against real schemas — and routes your traffic by what models can *actually*
do, at the best price that passes your bar.

- **Rig it** — define a *route*: a task handle bundling prompt, JSON schema,
  candidate models, and policy. Your app calls the task, not the model.
- **Prove it** — conformance bake-offs replay your own logged traffic against
  candidates and measure the *effective cost of conformance* — repairs
  included, value accuracy checked, zero production risk.
- **Sell it** — publish a route as a **rig**: a metered, billed AI endpoint
  with your price on it. You keep the spread; we keep it cheap to serve.

## What's in this repository

| Directory | What it is | License |
|---|---|---|
| `probes/` | The probe suite: schema conformance (parses ≠ conforms ≠ values-correct), grounding, caching | Apache-2.0 |
| `registry/` | The three-layer registry (declared / probed / observed-aggregate) + leaderboard generator | data CC BY 4.0 · code Apache-2.0 |
| `docs/` | Documentation source for [modelrig.dev](https://modelrig.dev) | Apache-2.0 |
| `kits/` | Contribution kits — probe fixtures, provider adapters | Apache-2.0 |

## Reproduce our numbers

Every published result is a sampled statistic with raw per-sample records and
a 95% confidence interval — never a single-shot verdict:

```bash
npx modelrig-probes run --model deepseek/deepseek-chat --class schema --samples 5
npx modelrig-probes verify <your-result>.json --against probes/results/<published>.json
```

A reproduction "passes" when your rerun lands inside the published interval.
Disagreements are contributions — file an issue with your result attached.

**Current reproducibility limits, stated plainly:**

- **`verify` is fully standalone today; `run` is not yet.** The probe runner
  drives provider adapters from the `modelrig` package, whose npm release is
  still a placeholder — so `run` currently executes only inside our
  workspace. Every published result ships with its raw per-sample records
  and fixture hashes, so `verify` lets you independently recompute all
  published statistics now. Self-contained provider callers (removing the
  `modelrig` dependency from `run`) are the next planned change to this
  repo.
- **Coverage: the v0 corpus is small and finance-weighted** — 10 fixtures
  (schema: 4 finance, 1 legal, 1 e-commerce · grounding: 2 finance,
  1 technical · caching: 1 general), seeded from our first production
  customer. Every fixture carries a `domain` tag and per-fixture stats are
  in each result file, so per-domain rates are always derivable — but treat
  The legal, e-commerce, and technical fixtures were added after the 2026-08-01 campaign — their results land in the next probe cycle; published rates currently cover the finance/general fixtures only.
  aggregate rates as corpus-wide, not domain-general. **The probe-kit's
  headline ask is fixtures from your domain** — see
  [kits/probe-kit](kits/probe-kit/).

`registry/leaderboard.html` ranks models by **conformance per dollar**
(effective $ per 1,000 schema-conformant outputs), with declared-vs-probed
discrepancies flagged prominently and the same coverage statement on the
page.

## Status

Under active development. The open-source probe suite, capability registry
data, and conformance leaderboard land here first.

- Website: [modelrig.ai](https://modelrig.ai)
- Docs: [modelrig.dev](https://modelrig.dev)
- npm: [`modelrig`](https://www.npmjs.com/package/modelrig)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — DCO sign-off, probe kit, adapter
kit, and a plain statement of the open/closed boundary.

## License

Code is released under [Apache-2.0](./LICENSE); registry data under
[CC BY 4.0](./registry/LICENSE).
