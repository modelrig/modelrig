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

## Migrate with your coding agent (60 seconds)

Paste this into Claude Code, Cursor, or any coding agent — it converts your
existing LLM calls into ModelRig routes without changing behavior:

```text
Migrate this project's LLM calls to ModelRig routes (https://modelrig.dev).

1. Find every direct LLM call (openai / @google/genai / deepseek SDK or raw HTTP).
2. For each call site, create modelrig/routes/<task>.yaml containing:
   - prompt: the existing prompt as a system template, with {{variables}} for the dynamic parts
   - schema: ./schemas/<task>.schema.json — the JSON Schema the caller expects (null if free-form)
   - candidates: ONLY the models this task is allowed to use today (same models as now)
   - policy: retries per failure class, timeout_ms, tier, json: native
3. Create modelrig/rig.yaml naming the project and the cost dimensions you tag calls with.
4. Replace each call site with:
     import { createRig, loadConfigFromEnv } from "modelrig";
     const rig = createRig(loadConfigFromEnv());
     const result = await rig.run("<task>", { input: { ...variables }, tags: { run_id } });
5. Provider keys move to environment variables (GEMINI_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY).
6. Do NOT change model choices or prompt content beyond templating — behavior must stay identical.
7. Run the project's tests and show me the diff before committing.
```

`modelrig init` will automate this; the prompt is the zero-install version.

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

- **Both `run` and `verify` are fully standalone.** As of 2026-08-02 the
  probe runner drives its own vendored direct-API callers
  (`probes/src/vendor/`) — the `modelrig` dependency is gone, so `run`
  executes anywhere with this repo checkout and your own provider API keys.
  Every published result still ships with its raw per-sample records and
  fixture hashes, so `verify` independently recomputes all published
  statistics without any API key at all.
- **Coverage: the v0 corpus is small and finance-weighted** — 10 fixtures
  (schema: 4 finance, 1 legal, 1 e-commerce · grounding: 2 finance,
  1 technical · caching: 1 general), seeded from our first production
  customer. Every fixture carries a `domain` tag and per-fixture stats are
  in each result file, so per-domain rates are always derivable — but treat
  aggregate rates as corpus-wide, not domain-general. The e-commerce and
  technical fixtures were added under addendum A2 on 2026-08-02, and all
  published results were re-run that day with the full corpus. **The
  probe-kit's headline ask is fixtures from your domain** — see
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
