# Artifact instrumentation (runs, steps, artifacts)

ModelRig can record the **execution graph** of any pipeline your code runs — the
run, its steps, and the artifacts each step produced (the prompt, the raw model
text, the parsed output, the evidence it grounded on) — with lineage,
evaluations, and an integrity hash for each. The console then renders that run as
a semantic chain you click through: *what your pipeline actually did*.

It is **on by default when a control plane is configured** (an api-mode
`rig_sk_` key, or the direct-mode Supabase pair) — metadata + hashes only. A
**pure local-only rig** (no sink to ship to) stays off. Either way it is
additive; set `MODELRIG_ARTIFACTS=0` to opt out, and with the namespace off it
is inert: `run.start` is a no-op, `artifact.save` returns null, no rows are
written, and your pipeline behaves byte-for-byte as before. `modelrig status`
prints the current posture (on/off + why).

> **Metadata + hashes only, this release.** The serialized value you save is
> hashed (sha256) and the bytes are **discarded** — nothing but the metadata row
> is persisted. Content custody (the blob path) ships in a later release; the
> hash proves integrity today. A `zeroRetention` run refuses every artifact
> fail-closed at the SDK gate.

## The namespace toggle

```bash
# On by default once a control plane is configured — nothing to set.
export MODELRIG_ARTIFACTS=0                  # opt OUT (or force ON with =1 on a
                                             #   local-only rig)
export MODELRIG_ARTIFACT_STEPS=step_a,step_b   # optional: instrument a subset
                                            # (unset/empty = every instrumented step)
```

Rows land in the local telemetry buffer and export to the control plane through
the standard sink (`MODELRIG_API_KEY` + `MODELRIG_INGEST_URL`, or the direct-mode
Supabase pair). With no sink configured they stay local.

An agent can do everything here except mint that `MODELRIG_API_KEY` — creating
it requires a human console login at <https://app.modelrig.ai>, so an
agent-driven setup should plan that one handoff rather than stall on it.

## Instrument a pipeline

The namespace hangs off `rig.artifacts`. Two moving parts: a **run context**
around the whole pipeline, and a **per-step save** of the work products.

```ts
import { createRig, loadConfigFromEnv } from "modelrig";

const rig = createRig(loadConfigFromEnv());

// 1. Open a run context around the pipeline. episodeKey bridges feedback;
//    it is a grouping key, not a unique id — a natural choice is your own
//    per-run attempt id.
const run = rig.artifacts.run.start({
  pipeline: "my-pipeline",
  episodeKey: runAttemptId,
  environment: process.env.NODE_ENV,
});
try {
  for (const step of steps) {
    const prompt = assemble(step);
    const result = await callModel(prompt);          // your own model call

    // 2. Save the step's artifacts. stepKey groups them in the console's
    //    chain view; task carries the semantic task name.
    const p = rig.artifacts.artifact.save(prompt, { name: `${step}.prompt`, type: "prompt", stepKey: step });
    const raw = rig.artifacts.artifact.save(result.rawText, { name: `${step}.raw`, type: "raw_response", stepKey: step });
    const parsed = rig.artifacts.artifact.save(result.json, {
      name: `${step}.output`, type: "step_output", task: step, stepKey: step, schema: step.schema,
    });

    // 3. Lineage: the parsed output derives from the prompt + raw; this step's
    //    prompt consumed the previous step's output.
    if (p && parsed) rig.artifacts.artifact.link(parsed, p, "derived_from");
    if (raw && parsed) rig.artifacts.artifact.link(parsed, raw, "derived_from");

    // 4. Evaluations (optional, deterministic): flag conformance, degraded
    //    provenance, anything you can decide without an LLM judge.
    if (parsed) rig.artifacts.artifact.evaluate(parsed, {
      evaluator: "schema-check", kind: "deterministic", passed: conforms(result.json),
    });
  }
  run.end("succeeded");
} catch (err) {
  run.end("failed");
  throw err;
}
```

For **concurrent** runs in one process, use `rig.artifacts.run.scope(opts, fn)`
instead of `start`/`end` — each scope keeps its own ambient context so
overlapping runs never cross-attribute. `run.start` uses `enterWith`, which is
right for one run at a time on a request/async path.

## Steps vs. artifacts

- An **artifact** is a work product — a durable thing your pipeline made. It
  always saves (metadata + hash), whether or not the model call went through the
  rig.
- A **step** is an execution row. `rig.run()` auto-creates a **ground-truth**
  step (its inference is real, so cost and latency are measured) when it runs
  inside a run context. A stage whose model call does *not* go through the rig
  produces artifacts with `step_key` set and **no step row** — which is correct
  and honest. Never route a stage through the rig just to mint a step row; the
  console renders "cost n/a" for un-routed steps rather than inventing a number.

## Never throws into your pipeline

Every entry point is fail-open: a telemetry-buffer write that fails is logged and
dropped, never thrown into your code. Instrumentation that runs *after* an
expensive model call must never be the thing that kills the run.

## See it

The console's **Runs** tab lists every instrumented run; `/runs/[id]` is the
semantic chain (artifacts grouped by step, with hashes, costs, and evaluation
badges) and `/artifacts/[id]` shows one artifact's lineage, versions, and
evaluations. Enabling the flag also lights up the `/setup` artifacts line.

## A reusable per-step seam

Most pipelines want one small helper that saves the three work products of a
step and wires their lineage, so the call sites stay a single line.
**`modelrig observe [path] --scope <one pipeline>` generates this seam for you**
(a `record-step` file) plus an `OBSERVE.md` whose per-call-site wiring is emitted
as diffs to apply — it never edits your source. The seam is equally yours to
write by hand; here it is, self-contained: 

```ts
import { createRig, loadConfigFromEnv, type Rig } from "modelrig";

const rig: Rig = createRig(loadConfigFromEnv());

/** Save prompt + raw + parsed for one step, link lineage, flag conformance. */
function recordStep(
  stepKey: string,
  work: { prompt: string; rawText: string; json: unknown; conforms: boolean },
): void {
  const p = rig.artifacts.artifact.save(work.prompt, { name: `${stepKey}.prompt`, type: "prompt", stepKey });
  const raw = rig.artifacts.artifact.save(work.rawText, { name: `${stepKey}.raw`, type: "raw_response", stepKey });
  const parsed = rig.artifacts.artifact.save(work.json, { name: `${stepKey}.output`, type: "step_output", task: stepKey, stepKey });
  if (p && parsed) rig.artifacts.artifact.link(parsed, p, "derived_from");
  if (raw && parsed) rig.artifacts.artifact.link(parsed, raw, "derived_from");
  if (parsed) rig.artifacts.artifact.evaluate(parsed, { evaluator: "schema-check", kind: "deterministic", passed: work.conforms });
}
```

Call `recordStep(step, { … })` once per stage inside the `run.start` / `run.end`
context above, and every entry point stays fail-open — a save that fails is
logged and dropped, never thrown into your pipeline.

> **In-repo example (reconstructed via onboarding-test run-2).** ModelRig's own
> customer-zero pipeline (the InferWealth v3 report generator) was stripped back
> to a clean slate to be re-onboarded through this exact doc. Its live seam is
> reconstructed as part of onboarding-test run-2; until then, the snippet above
> is the reference. Do not resurrect a deleted seam from git history — writing a
> fresh one is the point.
