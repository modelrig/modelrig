# Routing & reliability — how a `rig.run` call actually behaves

`rig.run(route, { input, tags })` returns a validated `output` plus a `meta`
record — a route is a contract, not a single model call. This page is about the
**candidate ladder**: the runtime loop that decides which model serves the call,
what makes it fall to the next one, what is stored along the way, and — just as
important — what it does **not** do. It is a different thing from the migration
playbook's **autonomy ladder** (the T0–T3 tiers), which happens to share the
word "ladder".

The vocabulary this page fixes, used the same way everywhere: a *candidate
ladder* is the runtime loop; an *attempt* is one dispatch, which is one
telemetry row; *fall-through* is advancing to the next candidate; the *repair
rung* is the schema-repair step; a *failure class* is the typed reason an
attempt failed; the *conformance gate* is what the ladder enforces (schema), as
opposed to a *quality gate* (a value judgment), which is **not built** (§10).

## 1. Resolve — who is eligible, and in what order

Before any model is called, resolve builds the eligible candidate list and
orders it. Filters apply in **a fixed order**: `providers.only` (keep only these
providers) → `providers.ignore` (drop these) → `require` (the hard capability
constraints, including a per-run `zeroRetention` opt-in) → `maxPriceUsdPerMTok`
(a price ceiling — an unpriced candidate is dropped when a ceiling is set, fail
closed) → sort.

`require` names hard constraints, and each one filters candidates:

- `schema_conformant` with `json: native` keeps only a candidate whose resolved
  flags include `structured_native` (overrides > probed > declared); with `json_mode` it keeps either `structured_native` or
  `json_mode`.
- `grounded` keeps native-grounded candidates, and a non-native candidate
  **only if a search provider is configured** (the grounding-inject rung);
  otherwise that candidate is dropped.
- `trace_visible` keeps candidates that expose the reasoning trace to the caller.
- `zero_retention` routes only to zero-retention–designated endpoints and fails
  closed — no designated candidate means the no-eligible-candidate error, never
  a silent non-ZDR dispatch. A single run opts in with `RunOptions.zeroRetention:
  true` (opt-in only, never opt-out).

Capability flags resolve by precedence: **overrides > probed > declared** — a
probed-false beats a declared-true.

Ordering: `prefer: [cost]` sorts by blended (in+out) $/MTok ascending; an unknown
price sorts last; the sort is stable, so ties keep declared order. `prefer:
latency` is **accepted and a no-op today** — declared order stands. No `prefer`
means declared order.

If nothing is eligible, resolve raises `RouteConfigError` **before any dispatch**
— there is no telemetry row. (A route with zero serveable candidates fails
earlier still, at load: `createRig` fails.)

A keyless candidate — one whose provider key is absent in this environment — is
**skipped at run time**: no dispatch, no row, no spend. It is remembered as a
`config_auth` last-failure, so a ladder of only keyless candidates throws
`config_auth`.

## 2. The candidate ladder

```
resolve -> ordered candidate list
for each candidate, in order:
  render prompt (variant prompt_append / scaffold)
    + json-mode coaching pasted in for any candidate lacking structured_native
    + grounding search: runs ONCE per run, reused across candidates and retries
    -> candidate-set invariant check
    -> envelope precheck (checks an upper-bound estimate against the envelope)
    -> dispatch on YOUR key
         |
         +- tool-call turn?          -> return output=null, meta.toolCalls (NO validation)
         +- valid?                   -> record + capture (if on) + return
         +- schema-invalid?          -> content_invalid row -> repair rung
         |                              -> retry SAME candidate while its budget lasts
         |                              -> then the next candidate
         +- retryable infra class?   -> retry SAME candidate within that class's
         |                              budget (with backoff) -> then the next candidate
         +- config_auth?             -> the next candidate, immediately
         +- budget_exhausted /
            invariant_violation?     -> ABORT the run

ladder exhausted -> RigFailureError(LAST failure)     # there is no meta on a failure
```

Per candidate, in order: the prompt is rendered (variant `prompt_append` or
`scaffold`); **json-mode coaching** is pasted into the prompt for any candidate
lacking `structured_native` (and always on `json: json_mode`); the grounding
search runs **once per run** and is reused across candidates and retries (a
search failure is a `network` failure); a candidate-set invariant check runs
before adapter lookup; the envelope precheck checks an upper-bound estimate against the envelope;
then the model is dispatched on your key.

The outcomes:

- A tool-call turn short-circuits **before validation**: `output` is null,
  `meta.toolCalls` is set, `meta.validated` is false — ModelRig never runs the
  tool (§9, and boundary B9).
- A valid output is recorded, captured (when capture is on), and returned.
- A schema-invalid output writes a `content_invalid` row, then the repair rung
  runs; the loop then retries the **same candidate** while its `content_invalid`
  budget has units (repair itself does not re-run), and only then advances.
- A retryable infrastructure class retries the same candidate within that class's
  budget (with backoff), then advances.
- `config_auth` advances to the next candidate immediately.
- `budget_exhausted` or `invariant_violation` **aborts the run**.

When the ladder is exhausted, `rig.run` throws `RigFailureError` **carrying the
last failure** — `.failure.class`, `.failure.message`, an optional
`.failure.provider` / `.model` / `.fixHint`, and a `.docsUrl` on the teaching
render — not a generic "all candidates exhausted" message (that string appears
only if nothing at all was recorded). There is **no `meta` on a failure**.

## 3. The repair rung, exactly

Repair is off unless a `repair:` block is declared. `max_repairs` is 1 or 2; 2
requires `repair_model`, which must be one of the route's declared candidates.
Attempt 1 re-asks the **same model** with the ajv error summary appended; attempt
2 hands `{invalid output, errors, schema}` — never the task prompt — to the
repair model. The repair budget is its own (never the `content_invalid` budget)
and is created **once per run — it does not re-arm** for the next candidate.
Repair rows carry `repaired_by`.

## 4. What makes the ladder fall to the next model — and what does not

| Falls through to the next candidate | Does NOT fall through |
|---|---|
| A schema-invalid output still invalid after the repair rung and the `content_invalid` budget | A schema-valid but low-quality answer — it is **accepted** |
| A retryable infra class after its budget (`capacity_shed`, `network`, `refusal`, `cache_invalid`, `timeout`) | A refusal within budget — it is retried, then falls through |
| `config_auth`, immediately | `budget_exhausted` / `invariant_violation` — the run aborts, it does not fall through |

There is no quality gate on the ladder: a schema-valid but low-quality answer is
accepted. **Value accuracy exists offline, in bake-offs**, not as a run-time gate
— see the boundary (§10) and how bake-offs measure it below (§6).

## 5. Failure classes

Every failure is typed. Default retry budget for every class is **0** — a
bundle declares each budget it wants under `policy.retries`.

<!-- FAILURE_CLASSES -->

## 6. What is stored, per attempt — and where it goes

One telemetry row is written **per attempt** — a serving attempt, a failed
attempt, and a repair attempt each get their own. The row carries: `id` (this is
`meta.inferenceId`), route and version, provider and model, requested and served
tier, tokens in / out / cached (plus cache-write), cost, `latencyMs`, `ttfbMs`,
`failureClass` (null means conformant — **there is no `validated` column** on the
row), attempts, tags, `servedVariant`, `repairedBy`, the cache key and prefix
fingerprint, and `pricingMissing`. Grounding adds a synthetic `provider =
"search"` cost row.

The `meta` returned to your code (`RunMeta`) is a smaller record:
`inferenceId`, `route`, `routeVersion`, `provider`, `model`, `requestedTier`,
`servedTier`, `tokensIn`, `tokensOut`, `tokensCached`, `costEstimateUsd`,
`latencyMs`, `validated`, `attemptsByClass`, `servedVariant`, `repairedBy`, and —
when they apply — `citations` and `toolCalls`. (`RunMeta.validated` is a boolean
you read; the stored row instead records conformance as `failureClass IS NULL`.)

Where the rows go: SQLite first, always. Setting `MODELRIG_API_KEY` turns on the
**api export mode** — a background exporter ships batches to the ingest API
(`api.modelrig.ai`, override with `MODELRIG_INGEST_URL`), which the console
reads. It is fire-and-forget and never blocks a run. Api mode also opens the
capture store, and a control-plane capture setting **wins over** the YAML
`capture:` field.

Who reads them: bake-offs and replay read captures; `rig.feedback` and the run
verdicts read the rows. `effective_usd_per_1k_conformant` is a **bake-off
metric** computed over replayed captures, not a rollup of production rows.

## 7. Spend envelopes

Envelopes are opt-in per run via `budget.envelope`. Open-or-get: the first opener
of a named envelope sets its budget and it is never resized; the **default is
$25**. A precheck checks an upper-bound estimate against the envelope before dispatch and aborts the
run (terminal `budget_exhausted`) on breach. An unpriced model is charged a
conservative rate against the envelope while telemetry records `$0` plus
`pricingMissing`. Envelope state persists in SQLite across restarts.

## 8. The raw lane is different

`rig.runRaw` calls one `provider`/`model` directly with a BYOK `apiKey`. It has
**no ladder, no `require`, no validation, no repair** — and no envelope;
`meta.validated` is always false. It writes one `lane: "raw"`-tagged row on
success **and** on adapter failure, and **no row** when a knob is rejected
pre-dispatch. Which knobs each provider honors is the generated
[provider × knob matrix](route-bundles.md#raw-lane-provider-knob-support-rigrunraw)
— read it there; it is never restated here. Constructing a runRaw-only rig with
`routesDir: null` is **unreleased — workspace only (ships in 0.4.0)**; see the
[migration playbook](migration-playbook.md).

> The multi-provider `reasoning` / native-grounding knobs and the
> `responseFormat` knob on the raw lane are **unreleased — workspace only (ships
> in 0.4.0)**; on the published package `reasoning` and native grounding are
> gemini-only and `responseFormat` does not exist yet. The provider × knob matrix
> marks each one.

## 9. Also on the ladder

- Streaming: `rig.runStream` is the identical ladder with a delta side-channel;
  deltas are pre-validation bytes and the `final` event is authoritative.
- Variants narrow the candidate set and can override the prompt, `json`, or
  `repair`; an unknown variant name is a `RouteConfigError` (no dispatch);
  `meta.servedVariant` names the variant that served (null = default).
- `cache: auto` stamps the per-provider cache directive (gemini is excluded); a
  customer cache handle (`RunOptions.cache`, provider-scoped) **wins over** the
  stamp and is **dropped on retry after `cache_invalid`** → see
  [caching lifecycle](caching-lifecycle.md).
- The engine adds tags: a ZDR-effective run gets `zdr_enforced: "true"`; the raw
  lane force-stamps `lane: "raw"`.
- Citations are normalized onto `meta.citations` on the grounding-inject rung.
- Observed latency (p50 / p90 / p99) is aggregated but **does not influence
  routing** today (§10, B3).

## 10. Not yet implemented — the boundary

The most useful thing docs can tell you is what the engine will **not** do, so
you size the product correctly. The entries below are grouped by status — not
built, deferred, built but not actuating, and by design (will not do).

<!-- ROUTING_BOUNDARY -->

This list is generated from code and tripwire-tested: if a feature listed
here ships, the build fails until the entry is updated.
