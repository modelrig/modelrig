# How it fits

One content source (this file) renders in the console `/setup` page and on modelrig.dev — edit here, surfaces follow.

ModelRig sits between your code and the model providers. Your repo declares **routes** — small YAML files naming a prompt, an output schema, and the models allowed to serve the task. Your app calls `rig.run("task.name")`; ModelRig renders the prompt, picks a model from the route's candidates using verified registry facts, enforces the schema, retries typed failures within per-class budgets, and hard-stops spending at your envelope caps.

Every call writes one telemetry row to a local SQLite file first — the run never blocks on the cloud. An async exporter mirrors rows to the console you are reading. Two things deliberately never leave your machine: provider keys, and **captures** (the recorded inputs and outputs some routes opt into for replay — the exporter has no code path to them).

Captures power **bake-offs**: replay your own recent traffic through route variants — a cheaper model, a different prompt — and get the effective cost of conformance for each, with confidence intervals. A winning variant is a proposal for you to apply in your YAML; nothing swaps models automatically.

The **registry** feeds routing from the side: declared claims, probed measurements, and observed traffic per model, with disagreements shown. A probed fact beats a declared claim — a model that declares schema support but failed our probes is not eligible to serve a schema route natively.

The loop, end to end: routes in your repo → `rig.run` in your app → local telemetry (+ local-only captures) → synced console → bake-offs prove cheaper variants → you edit the YAML. The console shows the truth; actions live in your code.
