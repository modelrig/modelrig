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

### ⏸ C2 — Caching, grounding & sampling inventory (the stop-gate)

**Before writing any route,** grep the target for provider caching,
provider-native grounding, **and explicit sampling parameters** — the three
behaviours that vanish *silently* on a naive migration (a cost regression, a
quality regression, and a consistency regression that only telemetry reveals).
Search for:

```
cachedContent        # Gemini explicit cache resource
cache_control        # Anthropic marker cache
prompt_cache_key     # OpenAI / Grok key-hint cache
cached_tokens | cache_read | cachedContentTokenCount   # cache usage in responses
temperature | top_p | topP | max_output_tokens | maxOutputTokens | max_tokens
                     # explicit sampling — a classifier at temperature 0.1 is a
                     # deliberate choice, not a default
```

**Any hit is a STOP-gate.** The route must carry the corresponding surface:

- **Caching** → the customer cache handle rides `rig.run(task, { cache: { key,
  provider } })` (or `rig.runRaw({ …, cache: { key } })`) — a one-field
  pass-through of the resource the customer already owns. ModelRig prices the hits
  but never manages the resource; a long job still needs the customer's TTL
  heartbeat. Full mechanics: [Caching lifecycle](https://modelrig.dev/caching-lifecycle.html).
- **Grounding** → `require: [grounded]` plus the route's grounding mode.
- **Sampling** → declare `policy.sampling` on the route:
  ```yaml
  policy:
    sampling: { temperature: 0.1, top_p: 0.9, max_output_tokens: 8192 }
  ```
  All three fields are optional; carry over exactly what the original call set.
  Absent, every adapter keeps its own defaults (Gemini runs at temperature 1.0),
  so a call that relies on a specific temperature — a classifier at 0.1, say —
  MUST declare it or it silently changes behaviour. A declared value is sent to
  the provider **as-is** (no clamp); an out-of-range value is a load-time config
  error (temperature 0–2, top_p (0,1], max_output_tokens ≥ 1). Note for Gemini 3:
  Google recommends temperature 1.0 and warns sub-1.0 values can loop/degrade on
  complex *reasoning* tasks — the loader logs an advisory for a sub-1.0 Gemini-3
  temperature and sends the request as declared (classification/extraction are
  typically fine).

If a surface cannot express what the code does yet, **report the gap and the
quantified cost/quality delta — never migrate past it silently.** Present the
inventory results and the decision (carry the handle, or a named, quantified
regression). Silent is the only forbidden outcome.

### The rig lifecycle (learned the hard way in the first Phase-0 swap)

- **Create once, close always.** One rig per server process (module singleton);
  per-invocation for one-shot jobs — and a one-shot caller MUST
  `await rig.close()` before exit, or telemetry rows are lost and the SDK's
  timers keep the process alive.
- **`tags` is required**, and every tag key must be declared as a
  `dimensions[].key` in `rig.yaml` (tag-safe `[A-Za-z0-9_]{1,64}`). An example
  that shows `tags: { run_id }` assumes a `run_id` dimension exists.
- **`result.output` is already parsed and schema-validated** — delete the old
  call site's `JSON.parse` and fence-stripping rather than keeping both.
- **Routes resolve from `./modelrig/routes` relative to the process CWD.** In a
  monorepo, place `modelrig/` at the app root and run from there, or set
  `MODELRIG_ROUTES_DIR` to an absolute path.
- **Load-check with `modelrig validate` — no key required.** It structurally
  loads `rig.yaml` and every route bundle, prints per-route OK / config error,
  and exits nonzero on any failure — the dry authoring check to run before you
  wire any credential. (Serving still fail-closes keyless: a live `createRig`
  needs at least one provider key so a route has a serveable candidate.)

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

**C3 — unprobed models are SERVABLE (ruled 2026-08-20).** Probes gate
*claims*, not *serving*: any model an adapter can reach may be a candidate,
probed or not. Pin the model production uses today as candidate #1 — always,
including models the registry has never probed — and **never silently
substitute a probed sibling for the one production runs.** What UNPROBED
actually means for a candidate (present these at C3, they are the honest
cost of no evidence, not a punishment):

- `json: native` may NOT be claimed for it (that is a probed-capability
  claim; the emulation ladder serves structure instead);
- no leaderboard standing, no bake-off priors, no declared-vs-probed
  discrepancy protection;
- pricing may be missing until the next pricing sweep — an unpriced model
  charges budget envelopes at the conservative rate (never rides free).

Flag each unprobed candidate UNPROBED in the C3 presentation and offer the
follow-ups: request a probe (probe-request page — customer traffic on a
model is exactly how it earns a place in the next probe cycle), and/or a
probed sibling as candidate #2 for the fallback slot.

**C4 decision — JSON-mode originals.** If the original call used mime-type
JSON plus app-side validation, declaring a `schema:` on the route is an
UPGRADE, not identity: the provider then enforces the schema and ModelRig's
repair ladder engages. Usually the right call — but it is a deliberate
behaviour change, so present it at C4 as one ("schema enforcement added"),
or set `policy.json: json_mode` with `schema: null` for closest identity.
Which wins is the human's ratification, never a silent default.

### ⏸ C5 — Keys & billing handoff (the setup a human must finish)

Everything above an agent does; placing **keys** and a **payment method** is the
one part it must hand to a human. Do not stall on it and do not do it for them —
present exactly what to place where, for the lane you chose at C1.

**The hard rule (non-negotiable): you never touch a key VALUE.** Not read beyond
an existence check, not print, not paste into the console, not put in a manifest.
Humans place keys directly. You check only whether a key EXISTS, by NAME:

```bash
# Existence only — prints the NAME and whether it is set, never the value.
for v in GEMINI_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY; do
  test -n "${!v}" && echo "$v: set" || echo "$v: MISSING"
done
```

Inventory the providers your written routes actually use (from the ratified
candidates), then present lane-aware instructions:

- **SDK lane (Lane A/B):** keys stay in the customer's own env. List the exact
  env var each provider needs and which are missing. Say plainly: in the SDK
  lane **ModelRig never receives your provider key** — the key stays in your env
  and calls go direct to the provider.
- **Hosted lane:** keys go in the console vault at **app.modelrig.ai → Keys**
  (`/vault`), placed by the human through the console form.

State the pricing fact at this decision point: **BYOK is 1,000,000 free requests
per month** (you bring the provider key; ModelRig meters, at zero per-request fee
up to that ceiling). A payment method (app.modelrig.ai → Billing) is only needed
for metered usage beyond the free tier.

**Then, and only if `MODELRIG_API_KEY` is set,** offer to pre-fill the human's
console checklist with a **metadata-only** manifest — provider NAMES and booleans,
never a key. Show the EXACT payload first and require an explicit yes:

```bash
# SHOW this to the human, ask "send this to pre-fill your console checklist?
# (metadata only — no keys)", and send ONLY on an explicit yes.
curl -sS https://api.modelrig.ai/v1/setup-needs \
  -H "authorization: Bearer $MODELRIG_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "manifest_version": 1,
    "lane": "sdk",
    "providers": [{ "provider": "gemini", "has_env_key": true }],
    "routes_count": 2,
    "needs": ["provider_key:gemini", "billing_card"],
    "notes": null
  }'
```

The server rejects any manifest carrying a secret-shaped value (400 + a teaching
error) — a backstop, not a licence to send one. **If `MODELRIG_API_KEY` is not
set, do not send anything** — print the instructions above and stop. On the
human's next console login, the "Finish your setup" card shows the same items
with live done/pending states (a key placed in the vault flips its item to done).

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
