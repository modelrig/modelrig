# The ModelRig feedback protocol (open)

Feedback is how judgment enters the optimization loop: a typed verdict your
code attaches to one model call (an **inference**) or to a whole run (an
**episode**). ModelRig aggregates it into per-route **optimization
coverage** — the evidence level that decides how much confidence a swap
proposal carries. The protocol is deliberately open: any tool that emits
rows in this shape can participate in the loop.

Every row is **org-scoped** — it lands in the organization its credential names,
and a verdict attached to a run renders on that [run's page](run-verdicts.md#on-the-run-page)
in the console alongside the run's verdicts.

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
normal cadence. To post judgment from a surface that isn't running the SDK — an
end user clicking thumbs-down in your web app — use the
[HTTP endpoint](#from-a-non-sdk-surface-http) below.

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

## From a non-SDK surface (HTTP)

When the judgment originates somewhere the SDK doesn't run — an end user in your
web app, a review tool written in another language — post it to
`POST /v1/feedback` on modelrig-server:

```bash
curl -X POST https://api.modelrig.ai/v1/feedback \
  -H "Authorization: Bearer $MODELRIG_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"episode": "run-123", "verdict": "down", "score": 0.2, "note": "CAGR off by 10x", "source": "app-user"}'
```

- **Authenticated, never public.** The request carries a `rig_sk_` key holding
  the `feedback` scope; there is no unauthenticated feedback endpoint.
- **The org rides the key, not the body.** Which organization the row belongs to
  is resolved from the credential — you cannot file a verdict into another org's
  corpus, and any org named in the body is ignored by construction.
- **Same fields as the SDK call:** `{inferenceId | episode, verdict: "up"|"down", score?, note?, source?}`. A missing or invalid verdict, or a target naming neither an inference nor an episode, is a `422` — rejected before authorization runs.
- **Response:** `{ id, ts, org_id }` — the stored row's id, its timestamp, and the org it landed in.

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
