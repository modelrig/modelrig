# The ModelRig feedback protocol (open)

Feedback is how judgment enters the optimization loop: a typed verdict your
code attaches to one model call (an **inference**) or to a whole run (an
**episode**). ModelRig aggregates it into per-route **optimization
coverage** — the evidence level that decides how much confidence a swap
proposal carries. The protocol is deliberately open: any tool that emits
rows in this shape can participate in the loop.

## The call

```ts
// one call — the inference id rides on every RunResult:
const result = await rig.run("example.support_summarize", { input, tags: { run_id } });
rig.feedback(result.meta.inferenceId, { verdict: "up" });

// a whole run (episode = your run_id tag):
rig.feedback({ episode: run_id }, { verdict: "down", score: 0.2, note: "CAGR off by 10x", source: "review-agent" });
```

The write is synchronous and local (SQLite) — never a network call, never a
failure your path can see. The cloud mirror rides the telemetry exporter's
normal cadence. Over HTTP: `POST /feedback` on modelrig-server with the same
fields (`{inferenceId | episode, verdict, score?, note?, source?}`).

## The row

| field | type | meaning |
|---|---|---|
| `id` | uuid | assigned at write |
| `ts` | ISO-8601 | when judged |
| `inference_id` | string \| null | the judged call; from `result.meta.inferenceId` |
| `episode_key` | string \| null | the judged run (matches the `run_id` tag) |
| `verdict` | `up` \| `down` | the primary signal — always required |
| `score` | number \| null | optional grade in [0, 1]; refines, never replaces, the verdict |
| `note` | string \| null | free text for humans reading the row later |
| `source` | string | who judged: `sdk`, `human`, a review-agent name, … |

Exactly one of `inference_id`/`episode_key` is typically set (both-null is
rejected). Feedback that matches no known inference or episode attaches to
nothing — attribution is never guessed.

## The ladder (rungs 0–1 today)

- **Rung 0 — implicit, free with traffic:** conformance / repair / refusal
  rates per route, computed from telemetry. Enough for schema-mechanical
  proposals: the bake-off gate (conformance CI + effective cost) does the
  judging.
- **Rung 1 — explicit verdicts:** a route with ≥10 attached feedback rows.
  Routes with no schema to conform to (prose outputs) gain proposal
  confidence only this way.
- **Rungs 2+ — judges:** value accuracy beyond mechanical conformance;
  a later phase. The protocol shape above does not change — judges are just
  another `source`.

Coverage renders per route on the console's `/coverage` page.

## Privacy

Feedback rows carry your verdict and note — never the model's input or
output text (those live only in the local, never-exported capture store when
a route opts in). The mirror is subject to the same export isolation as all
telemetry.
