# ModelRig quickstart — see, prove, and save on every model call

ModelRig is the operating layer for your AI workstream. Each LLM task becomes a
**versioned route file** (prompt template + JSON schema + candidate models +
policy) that you call with one line — `rig.run("task.name", {input, tags})` —
and three things happen at once:

- **See** — the run lands in an **inspectable artifact store** (runs → steps →
  artifacts, lineaged and integrity-hashed; see the
  [instrumentation guide](instrumentation.md)), with cost/tokens/tier and a
  verdict recorded against your tags.
- **Prove** — you get schema-validated output, served only by a model you
  authorized, and you can replay that traffic against cheaper candidates in a
  bake-off before you change anything.
- **Save** — a winning candidate is a change to your YAML you review; nothing
  swaps a model on its own, and your routes are always YAML in your git.

The rest of this page is Step 0 (two minutes, once), then the two ways to
instrument your project — point your coding agent at it, or do it by hand.

## Step 0 — create your org and key (two minutes, human-only)

Account setup stays human: your coding agent never creates accounts, signs in,
or holds credentials. Once, up front:

1. Sign up and create your organization at
   [app.modelrig.ai](https://app.modelrig.ai) — email and an org name is the
   whole form.
2. Issue an API key in the console (the `rig_sk_…` value is shown once — copy it).
3. Export it beside your provider keys: `MODELRIG_API_KEY=rig_sk_…`.

That key is the only ModelRig credential your app ever holds — never a database
URL, never a service-role key. Provider keys never leave your process.

**No account needed for the open lane:** with only your provider keys set,
routes, probes and telemetry run entirely on your machine — the hosted console
and synced telemetry are what the key unlocks. You can add it later.

There are two ways your calls are keyed and billed, and you pick per route:

- **Bring your own keys (BYOK).** Your provider keys stay in your environment;
  ModelRig routes to the provider directly. The first 1,000,000 requests each
  month are free, then a flat 2% of list price.
- **Managed keys.** ModelRig fronts the provider's inference cost, so managed
  calls are provider cost + 2% from the first request — no key for you to hold.

Same flat 2% margin either way; your negotiated provider discounts stay yours.

## Point your coding agent at it

The fastest migration is the one your agent performs. From inside your project,
paste this into Claude Code, Codex, or Cursor:

```
Migrate this project to ModelRig routes (https://modelrig.dev).

0. If MODELRIG_API_KEY is not set and I want hosted telemetry, STOP and ask me
   to create an org and issue a rig_sk_ key at https://app.modelrig.ai. Never
   create accounts, sign in, or handle credentials yourself. Without the key,
   proceed in local-only mode — that is fully supported.
1. Read https://modelrig.dev/quickstart.html and
   https://modelrig.dev/route-bundles.html.
2. Find every place this codebase calls an LLM API directly.
3. For each call site, define a route bundle YAML (schema, candidate models,
   policy, prompt template) and replace the direct call with
   rig.run("<route.name>"). Keep prompt and schema semantics unchanged.
4. Before naming any model capability, check the probed registry — declared
   flags and probed behavior differ; trust the probed layer.
5. Run the project's existing tests and report every file you changed.
```

Your agent reads the docs, finds your LLM call sites, and turns them into
routes. It **won't** create accounts, sign in, or touch your API keys (those
stay in the environment you set in Step 0), and it swaps call sites to
`rig.run()` without changing prompt or schema semantics — same model, human-
reviewed. The full autonomy ladder and same-model guarantees are in the
[migration playbook](migration-playbook.md).

## Or set it up by hand

### 1. Install

```bash
pnpm add modelrig      # or npm i modelrig — Node >= 20
```

It builds a native module (`better-sqlite3`) on install, so the machine needs a
toolchain.

```ts
import { createRig, loadConfigFromEnv } from "modelrig";
```

Environment (read once, in ModelRig's config layer only):

```bash
GEMINI_API_KEY=…        # only providers you configure get adapters
OPENAI_API_KEY=…
DEEPSEEK_API_KEY=…

# Where your telemetry goes — pick ONE lane:
MODELRIG_API_KEY=rig_sk_…                      # hosted: rows go to ModelRig,
                                               # scoped to the org that key names
# (omit it and everything below still works, locally)
MODELRIG_ROUTES_DIR=./modelrig/routes          # default
MODELRIG_TELEMETRY_DB=./.modelrig/telemetry.db # default
MODELRIG_ENVELOPE_BUDGET_USD=25                # default envelope budget
```

Provider keys never leave your process on either lane. A `rig_sk_` key is issued
in the console at [app.modelrig.ai](https://app.modelrig.ai) and is the only
ModelRig credential your app ever holds — never a database URL, never a
service-role key.

### 2. Define a route bundle

One YAML file per route under `modelrig/routes/`:

```yaml
# modelrig/routes/example.support_summarize.yaml
route: example.support_summarize   # the task handle you pass to rig.run
version: 1                         # bump on ANY change
schema: ./schemas/support_summarize.schema.json  # null for unstructured routes
candidates:                        # THE candidate set — the invariant boundary.
  - provider: openai               # Nothing outside this list can ever serve
    model: gpt-5.4-mini            # the route: enforced by a branded type at
  - provider: gemini               # compile time and a runtime guard.
    model: gemini-3.1-flash-lite
require: [schema_conformant]       # hard constraints on candidate eligibility
prefer: [cost]                     # advisory ordering (cheapest first)
prompt:
  system: ./prompts/support_summarize.system.md
  variables: [ticket, product, priorContext]
policy:
  retries: { content_invalid: 2, network: 4, capacity_shed: 3 }
  timeout_ms: 60000
  tier: flex                       # requested tier; served tier is recorded
  json: native                     # native strict schema | json_mode (rung 2)
  sampling: { temperature: 0.1, max_output_tokens: 8192 }
  #                                  ^ preserve the original call's sampling;
  #                                    absent = the adapter's own defaults
```

Prompt templates support `{{variable}}` substitution and capability-conditional
blocks resolved against the **serving** candidate's flags:

```
Summarise this ticket for the next agent: {{ticket}}

{{#if capability.grounded_native}}
Use web search to verify recent events.
{{/if}}
{{#unless capability.structured_native}}
CRITICAL: respond with a single JSON object, no markdown fences.
{{/unless}}
```

Variables must be declared in `prompt.variables`; referencing an undeclared
variable fails at load time, not at run time.

The `schema` file is a JSON Schema. ModelRig validates output under **JSON
Schema 2020-12** as the primary dialect and **also accepts draft-07** (a schema
declaring either `$schema` compiles). Validation runs non-strict with union
types allowed, and `format` is annotation-only — it is not asserted (an
`email`/`date-time` format is documentation, not a constraint). Author 2020-12
unless you have a draft-07 schema already; both work.

### 3. Call it

```ts
const rig = createRig(loadConfigFromEnv());

const result = await rig.run("example.support_summarize", {
  input: { ticket: rawTicket, product: "Acme Cloud", priorContext: history },
  tags: { run_id: "run-123", step: "summarize", customer: "acme" },
  budget: { envelope: "run-123" },   // hard-stop cost envelope for the run
});

result.output;                 // JSON, already validated against your schema
result.meta.provider;          // which candidate actually served
result.meta.costEstimateUsd;   // priced from the pinned LiteLLM snapshot
result.meta.servedTier;        // vs meta.requestedTier — downgrades visible
result.meta.attemptsByClass;   // retries consumed, per failure class

rig.close();
```

## When it fails, it fails typed

```ts
import { RigFailureError } from "modelrig";

try {
  await rig.run("example.support_summarize", opts);
} catch (err) {
  if (err instanceof RigFailureError) {
    err.failure.class;   // content_invalid | capacity_shed | network | refusal
                         // | cache_invalid | timeout | config_auth
                         // | budget_exhausted | invariant_violation
    err.failure.fixHint; // machine-readable remediation when available
  }
}
```

Retry budgets are **per class and non-fungible** — exhausting `network`
retries never consumes the `content_invalid` budget. Terminal classes
(`budget_exhausted`, `invariant_violation`) are never retried.
`config_auth` (bad or missing credentials) is **non-retryable by contract**:
it cannot appear in a bundle's retry budgets, is never retried on the same
candidate, and the run loop advances straight to the next candidate — a dead
key never burns backoff time. Failures that still billed tokens (refusals,
truncations) carry their token usage, so envelopes and telemetry account the
real spend.

## Where the telemetry goes

Every attempt (not just every run) writes one row to package-owned SQLite,
tagged with your `tags`. If the Supabase sink is configured (the Supabase URL
and service-key environment variables — see `.env.example`), an async
batch exporter mirrors rows to the ModelRig control-plane project —
fire-and-forget, queue-on-failure; the inference path never blocks on it.
Inspect live rows in Supabase Studio or the console (see
[staging.md](./staging.md)).

Telemetry says what happened; **verdicts** say whether it was good. Attach a
thumbs up/down to a call or a whole run with `rig.feedback(...)` — from the SDK
or over HTTP for a non-SDK surface (see the
[feedback protocol](feedback-protocol.md)) — and every run gets an automatic
`run-outcome@v1` verdict, with an explicit, bounded model judge available when
you want one (see [run verdicts](run-verdicts.md)).

## Runtime requirements

ModelRig assumes a **long-lived Node process with a writable disk**, and a few
things follow from that. Check them before you deploy:

- **Node ≥ 20**, and a native build toolchain at install time — it compiles
  `better-sqlite3` (a C/C++ addon) for the local telemetry buffer. On a slim
  container add the build essentials (`python3`, `make`, a C++ compiler).
- **A writable disk.** Telemetry and captures go to a local SQLite file
  (`MODELRIG_TELEMETRY_DB`, default `./.modelrig/telemetry.db`); the background
  exporter batches from it. A read-only filesystem breaks this.
- **Serverless (Vercel functions, AWS Lambda, Google Cloud Functions):**
  supported, with two required adjustments. (1) Point the telemetry DB at the
  only writable location — `MODELRIG_TELEMETRY_DB=/tmp/modelrig/telemetry.db`.
  (2) `await rig.close()` **once per invocation** before the handler returns:
  the function may freeze or be killed the moment you respond, and `close()` is
  what drains the final rows (H1) — skip it and you silently lose the last
  attempts of every invocation. Expect a native-module cold-start cost on the
  first call after a scale-up.
- **Edge runtimes (Vercel Edge, Cloudflare Workers) are unsupported.** They have
  no native-addon support and no filesystem, so `better-sqlite3` cannot load at
  all. Run ModelRig in a Node runtime; if an edge function must call a route,
  put ModelRig behind a Node service it calls over HTTP.

## When it doesn't work

The first three failures below stop the bundle loading; the fourth lets it load
and then misbehave, so it is the one to watch for. The full list, in the
loader's own words, is in [route-bundles.md](./route-bundles.md#when-it-doesnt-work).

- **The bundle won't load, naming a schema or prompt path.** The file isn't at
  the path the bundle names — paths resolve relative to the bundle. Create it
  there, or set `schema: null` for a free-form task.
- **The bundle won't load, naming an undeclared variable.** A `{{name}}` in the
  template isn't in `prompt.variables`. Add it (or fix the typo).
- **The first call succeeds locally but nothing appears in the console.**
  `MODELRIG_API_KEY` isn't set in that environment. Everything runs without it;
  it only decides where telemetry lands.
- **The call runs but the output isn't what the old code produced.** Usually a
  wrong `json: native` — a claim about the model, valid only for one whose
  registry entry shows probed `structured_native`. Check the probed registry,
  not memory.

Still stuck? Open an issue at <https://github.com/modelrig/modelrig/issues>.
