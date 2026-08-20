# Migrate a codebase to ModelRig — the T0–T2 playbook

This is the canonical playbook the ModelRig skill follows when you import it into
your coding tool (Claude Code, Cursor, Codex, …) and ask it to onboard a
codebase. It is a **pointer skill**: the skill file itself holds almost no facts
and fetches this page, so one copy serves every ecosystem and a stale cached
answer never overrides the current one.

The skill performs the *full* migration, not just detection: it finds LLM call
sites, instruments work-product boundaries, and — one call site at a time —
replaces direct provider calls with ModelRig routes. It does this on a **four-tier
autonomy ladder** that treats behaviour-preserving work differently from
behaviour-affecting work, and it keeps model optimization permanently out of its
own hands.

> **The skill flags; it never forces.** Where a call site does not fit a tier,
> the skill says so and routes it to the correct, lower tier — a raw-lane
> outcome is a *correct* result, not a failure. See "Stated limits" below.

## The autonomy ladder

| Tier | Action | Risk class | Agent autonomy |
|---|---|---|---|
| **0** | **Gateway pointing:** swap an OpenAI-compatible base URL to the raw lane | Transport-only | Apply after plan review — telemetry/cost/envelopes light up instantly |
| **1** | **Instrumentation:** steps, artifacts, lineage; detect existing OTel and extend, never duplicate | Behaviour-preserving (the SDK contract: return values never change) | Plan-before-edit, then apply; the validator warns on over-instrumentation |
| **2** | **Route extraction:** prompt → `systemTemplate` + variables, schema from Zod/TS types (or `schema: null`), call site → `rig.run()` — **always same-model** | Behaviour-affecting | Propose → verify (type-check + your tests + `modelrig verify-swap` shadow-equivalence) → **human merges**; one call site per PR |
| **3** | **Model optimization** | — | **Never the skill's job** — its output feeds bake-offs; swaps stay behind the existing approval gate |

The dividing line is risk class, not effort: **T0 and T1 preserve behaviour**, so
the agent applies them after a plan review; **T2 changes what serves a call**, so
the agent only *proposes* it, proves it, and a human merges it. **T3 is off the
ladder** — the skill's job ends at producing the evidence; a model swap is a
separate, human-gated bake-off decision (see Tier 3).

## Before you start — the one human handoff (F-6)

Everything upstream of the console an agent can do now. The one step it cannot is
**minting an API key**, which needs a console login at <https://app.modelrig.ai>
(`/keys`) — account/password auth. Plan that handoff rather than stalling on it:

```bash
export MODELRIG_API_KEY=<minted at app.modelrig.ai/keys by a human, once>
# The default ingest host (https://api.modelrig.ai) needs no other config.
```

A key is **not** required to run routes locally — it only decides where telemetry
lands. But *observing your runs in the console* (Tier 1's payoff) does need it.

---

## Before the ladder — which lane, and the two inventories

The autonomy ladder (T0–T2) is *how* you migrate one call site. **The lane is
which strategy fits the whole codebase** — decided once, up front, from the shape
of the code. Get this wrong and you either over-engineer a naive app or try to
externalize a routing engine that already exists. You (the coding agent) work the
lane assessment and the inventories yourself, then **stop at the checkpoints** (⏸)
and present to your human.

### The three lanes

- **Lane A — naive call sites.** Static prompts, a fixed model per call, no
  provider abstraction. This is the greenfield case the ladder was written for:
  extract routes (Tier 2), replace call sites with `rig.run`. First route in under
  an hour.
- **Lane B — an existing router / orchestrator.** The code already has a provider
  abstraction, runtime-assembled prompts, and env- or logic-resolved model choice
  (a `callProvider(provider, prompt, model)` dispatcher is the tell). **Do not
  write per-task routes for this.** Migrate ONE naive call site as a reference
  route, then integrate the router at the **`rig.runRaw` adapter seam** — replace
  the dispatcher's body with `rig.runRaw({ provider, model, … })`. ModelRig
  provides telemetry, fallback, and accounting; your code keeps prompt assembly and
  cache lifecycle. BYOK, zero-margin, no route externalization.
- **Lane C — full route migration of a Lane-B system.** Externalizing a dynamic
  prompt assembler into route templates is a scoped *project* (prompt
  externalization), never an onboarding step. Recognize it, name it, and leave it
  for later.

The lane picks which tiers apply: Lane A runs the full T0→T2 ladder; Lane B stops
at the `runRaw` seam (T0/T1 plus the one reference route) and defers T2-for-everything
to Lane C.

### ⏸ C1 — Fit assessment (present the verdict + lane)

Inventory the LLM call sites and classify the codebase (naive vs. router layer).
Present which lane you chose and why. See "Call-site scope" for what counts.

### ⏸ C2 — Caching & grounding inventory (the stop-gate)

**Before writing any route,** grep the target for provider caching and
provider-native grounding — the two behaviours that vanish *silently* on a naive
migration (a cost regression and a quality regression that only telemetry reveals).
Search for:

```
cachedContent        # Gemini explicit cache resource
cache_control        # Anthropic marker cache
prompt_cache_key     # OpenAI / Grok key-hint cache
cached_tokens | cache_read | cachedContentTokenCount   # cache usage in responses
```

**Any hit is a STOP-gate.** The route must carry the corresponding surface:

- **Caching** → the customer cache handle rides `rig.run(task, { cache: { key,
  provider } })` (or `rig.runRaw({ …, cache: { key } })`) — a one-field
  pass-through of the resource the customer already owns. ModelRig prices the hits
  but never manages the resource; a long job still needs the customer's TTL
  heartbeat. Full mechanics: [Caching lifecycle](https://modelrig.dev/caching-lifecycle.html).
- **Grounding** → `require: [grounded]` plus the route's grounding mode.

If a surface cannot express what the code does yet, **report the gap and the
quantified cost/quality delta — never migrate past it silently.** Present the
inventory results and the decision (carry the handle, or a named, quantified
regression). Silent is the only forbidden outcome.

### Package manager (detect, don't assume)

Install with the project's OWN package manager — read it from the lockfile:
`pnpm-lock.yaml` → `pnpm add modelrig`; `yarn.lock` → `yarn add modelrig`;
`package-lock.json` → `npm i modelrig`. Running `npm i` in a pnpm workspace
corrupts the store — never hard-code `npm`. Node ≥ 20; provider keys stay in env
vars.

### Call-site scope (what "every LLM call" means)

- **In scope:** text/JSON *generation* calls, including the secondary
  extractor/repair follow-ups that are part of a generation flow (a JSON-extractor
  retry on a malformed response is in scope — it is the same logical call).
- **Out of scope (v1, state it explicitly):** embeddings, web-search tool calls,
  and rerankers. These are not generation routes; say so rather than guessing.

### ⏸ C3 — Candidate ratification · ⏸ C4 — Prove it

C3 (ratify the proposed candidate list) and C4 (tests + diff + the week-one
cache-hit-rate/cost panel comparison) are the Tier 2 gates below — the human
merges on a green report. A zero cache-hit rate on a route that cached before
migration is a regression; say so at C4.

---

## Tier 0 — Gateway pointing (transport-only)

The lightest possible change: point an existing OpenAI-compatible client at the
ModelRig **raw lane** by swapping its base URL. Nothing about the request or the
model changes — the traffic just flows through the gateway, so telemetry, cost,
and budget envelopes light up instantly with zero behaviour risk.

Because it is transport-only, the agent **applies it directly after a plan
review**. This is the correct home for call sites that resist template extraction
(dynamically-assembled prompts) and for freeform chat / agentic loops — see
"Stated limits".

## Tier 1 — Instrumentation (behaviour-preserving)

Record each pipeline run as a **run → step → artifact** chain — the prompt, the
raw model text, the parsed output, the evidence it grounded on — with lineage and
an integrity hash per artifact. This is **behaviour-preserving**: the SDK contract
is that instrumentation never changes a return value, and with the namespace off
the pipeline is byte-for-byte identical.

Scaffold it with the CLI, then apply the emitted diffs:

```bash
modelrig observe [path] --scope <one pipeline>   # or: modelrig init --observe
```

`modelrig observe` generates a fresh, self-contained `record-step` seam and an
`OBSERVE.md` whose per-call-site wiring is emitted as `diff` blocks. The
instrumentation it produces is a **code-level SDK seam** — there is no zero-code
observe — but you no longer hand-write it. The agent **plans before editing, then
applies** (behaviour-preserving), and the validator warns when a stage is
instrumented that should not be. **Detect existing OpenTelemetry and extend it —
never duplicate a span the customer already emits.**

Full mechanics: [Observe a pipeline](https://modelrig.dev/instrumentation.html).

## Tier 2 — Route extraction + same-model call replacement (behaviour-affecting)

Turn a direct provider call into a ModelRig **route**: the prompt becomes a
`systemTemplate` + declared variables, the schema comes from the call site's Zod /
TS types (or `schema: null` when it asked for no structure), and the call site
becomes `rig.run(<route>, …)`. **The replacement is always same-model** — the
route pins the exact provider/model the original used. This is the C2-exit
gateway-substitution ruling: T2 changes the *plumbing*, never the *model*. A model
change is Tier 3, and never the skill's.

Because this is behaviour-affecting, the agent **proposes, never applies**:

1. **Draft the route.** `modelrig init --scope <one pipeline>` finds the call
   site and drafts a route bundle + a `MIGRATION.md` line for it. It writes only
   under `modelrig/routes/drafts/` and never edits source. (A route bundle is
   validated at load — missing schema/prompt files, undeclared `{{variables}}`,
   and a bad `json: native` claim all fail loudly, so a drafted bundle either
   loads clean or tells you exactly what is wrong.)
2. **Verify before proposing a merge.** The bar is:
   - **type-check** passes,
   - the customer's **own tests** pass, and
   - **`modelrig verify-swap`** returns a passing shadow-equivalence report:
     ```bash
     modelrig verify-swap --route <route> --captures <fixture.json> --out pr-report.md
     ```
     It captures N calls of the original locally, replays the SAME inputs through
     the drafted route **with the original model pinned**, and diffs the outputs.
     Its verdict vocabulary is honest: `EQUIVALENT`, `EQUIVALENT (modulo
     nondeterminism)`, `DIVERGENT` (do not merge), or `REFUSED` (not a T2
     replacement — T0/T1 territory). Exit code is the gate: `0` pass, `1`
     divergent, `2` refused.
3. **Embed the report in the PR.** Paste the `pr-report.md` the verifier wrote
   verbatim into the PR body. It carries the plumbing-not-model-choice guarantee
   so a reviewer cannot mistake equivalence for a model-quality claim, and it
   states rollback in the same breath.
4. **One call site per PR.** This keeps `git revert` a byte-for-byte restore and
   keeps the diff inside the customer's codebase legible — a product surface.
5. **A human merges.** The skill's autonomy ends at a green report and an open PR.

### Replaced-call disposition (RULED, Matt 2026-08-16): DELETE the original, never comment it out

Rollback is git-native and the skill makes it explicit:

- **(a)** one call site per PR means `git revert` restores the original
  byte-for-byte;
- **(b)** the PR body quotes the original call **verbatim** with an explicit
  `Rollback: revert this PR` line;
- **(c)** a one-line breadcrumb comment stays at the site:
  ```ts
  // modelrig: migrated from <original call> — rollback: revert PR #N
  ```

**Commented-out originals are banned** — they rot against the live call, and our
diffs inside customer codebases are a product surface. Because the replacement is
same-model, behavioural rollback is *additionally* a route-YAML flip, not a code
operation.

## Tier 3 — Model optimization: NOT the skill's job

Choosing a *cheaper or better* model is **permanently out of the skill's hands.**
The skill's T2 output — routed call sites with same-model parity — is precisely
the evidence a bake-off needs. From there, optimization stays where it already
lives: `modelrig bakeoff` replays your own traffic through a challenger, a
proposal is raised, and **nothing switches** what serves a route without an
explicit human approval (`modelrig swap execute <id> --approve`). "Actions live in
your code" — the swap path emits route YAML, it never edits your source. The skill
recommends; it does not rewrite your model choices.

## Stated limits (the skill flags, never forces)

- **Dynamically-assembled prompts** resist template extraction → **Tier 0/1**
  treatment (instrument or point the gateway; do not force a brittle template).
- **Freeform chat / agentic loops** don't fit task-shaped bundles → **raw lane**
  (a correct outcome, not a failure).
- **Streaming call sites** are recognized and routed per the batch-first
  deferral — **not silently converted**.

Each of these is a call the skill surfaces to you with a reason, never a silent
downgrade.

## Recognition playbooks (per provider)

How the skill recognizes a call site and what the before/after looks like — for
OpenAI, Anthropic, the Vercel AI SDK, LangChain, and raw `fetch` — lives in the
[recognition playbooks](https://modelrig.dev/migration-recognition.html), with
canonical before/after examples for each.
