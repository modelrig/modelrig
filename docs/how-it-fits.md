# How it fits

One content source (this file) renders in the console `/setup` page and on modelrig.dev — edit here, surfaces follow.

ModelRig sits between your code and the model providers. Your repo declares **routes** — small YAML files naming a prompt, an output schema, and the models allowed to serve the task. Your app calls `rig.run("task.name")`; ModelRig renders the prompt, picks a model from the route's candidates using verified registry facts, enforces the schema, retries typed failures within per-class budgets, and hard-stops spending at your envelope caps.

Every call writes one telemetry row to a local SQLite file first — the run never blocks on the cloud. An async exporter mirrors rows to the console you are reading. Provider keys are the one thing that deliberately never leaves your machine; the exporter has no code path to them.

What is retained beyond that is your choice, per route, and there are two lanes.

**Pure router** (capture off). Nothing retained. Real, supported, selectable, and the honest answer for a ZDR-strict or data-residency-bound workload.

**Optimization on** (recommended). Your traffic is what makes the routing smarter and the bill smaller. **What is kept:** per-inference telemetry rows, and bounded review samples for the bake-offs you create. **Where:** your organization, row-scoped by the database, not by our application code. **How you leave:** see it all in the console, delete it, export it, take your routes and go — they were always YAML in your git. **What you get back:** community priors on your very first bake-off and RigIndex-grade evidence on your own routes — at the same flat 2% either way; the corpus earns its place by being useful, not by being a discount.

Captures power **bake-offs**: replay your own recent traffic through route variants — a cheaper model, a different prompt — and get the effective cost of conformance for each, with confidence intervals. A winning variant is a proposal for you to apply in your YAML; nothing swaps models automatically.

The **registry** feeds routing from the side: declared claims, probed measurements, and observed traffic per model, with disagreements shown. A probed fact beats a declared claim — a model that declares schema support but failed our probes is not eligible to serve a schema route natively.

The loop, end to end: routes in your repo → `rig.run` in your app → local telemetry (+ captures on the routes where you turn Optimization on) → synced console → bake-offs prove cheaper variants → you edit the YAML. The console shows the truth; actions live in your code.
