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

## Status

Under active development. The open-source probe suite, capability registry
data, and conformance leaderboard land here first.

- Website: [modelrig.ai](https://modelrig.ai)
- Docs: [modelrig.dev](https://modelrig.dev)
- npm: [`modelrig`](https://www.npmjs.com/package/modelrig)

## License

Open-source components are released under [Apache-2.0](./LICENSE).
