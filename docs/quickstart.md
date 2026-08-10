# ModelRig quickstart — define a route, call `rig.run()`

ModelRig turns each LLM task into a **versioned route file** (prompt template +
JSON schema + candidate models + policy) and one call:
`rig.run("task.name", {input, tags})`. You get schema-validated output with
cost/tokens/tier recorded against your tags — and no possibility of a request
being served by a model you didn't authorize.

## 1. Install

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

## 2. Define a route bundle

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

## 3. Call it

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

## 4. When it fails, it fails typed

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

## 5. Where the telemetry goes

Every attempt (not just every run) writes one row to package-owned SQLite,
tagged with your `tags`. If the Supabase sink is configured (the Supabase URL
and service-key environment variables — see `.env.example`), an async
batch exporter mirrors rows to the ModelRig control-plane project —
fire-and-forget, queue-on-failure; the inference path never blocks on it.
Inspect live rows in Supabase Studio or the console (see
[staging.md](./staging.md)).

## 6. When it doesn't work

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
