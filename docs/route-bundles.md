# Route bundle reference

One YAML file per route under the routes directory (default `modelrig/routes/`).
Files are loaded, structurally validated, and frozen at `createRig()` time; any
invalid bundle throws a `RouteConfigError` naming the file and every problem.

## Top-level fields

| field | type | required | notes |
|---|---|---|---|
| `route` | string | yes | The task handle passed to `rig.run()`. Unique across the directory (duplicates are a load error). |
| `version` | integer ≥ 1 | yes | Bump on ANY change to the bundle, schema, or prompt. Recorded on every telemetry row. |
| `schema` | relative path \| null | yes | JSON Schema file for the output. `null` = unstructured route (output must still be parseable JSON). Path resolves relative to the bundle file. |
| `candidates` | list | yes, non-empty | THE candidate set. Each entry is `{provider, model}`. Providers (the `ProviderId` union): `gemini`, `openai`, `deepseek`, `anthropic`, `grok`, `deepinfra`, `fireworks` — all with adapters. Nothing outside this list can serve the route — enforced structurally (branded `CandidateRef`) and at runtime. |
| `require` | list | no | Hard constraints: `schema_conformant`, `grounded`, `zero_retention`, `trace_visible` (v2 — reasoning trace exposed to the caller). `grounded` is satisfied natively OR — when a search provider is configured — via the grounding-inject rung (search results injected into the prompt, citations normalized onto `RunMeta.citations`, search cost accounted). `zero_retention` is an **opt-in data-governance filter** (G-3): it routes only to zero-retention–designated endpoints, and fails closed (no designated candidate → the no-eligible-candidate error, never a silent non-ZDR dispatch). A single run can opt in without editing the bundle via `RunOptions.zeroRetention: true`. How `require` filters and orders candidates at run time is on [Routing & reliability](routing-reliability.md#1-resolve-who-is-eligible-and-in-what-order). |
| `prefer` | list | no | Advisory ordering: `cost` (ascending via the pricing snapshot; unknown cost sorts last), `latency` (accepted and currently a no-op — declared order stands; observed-latency sort is deferred to the observed-health work). Ordering is explained on [Routing & reliability](routing-reliability.md#1-resolve-who-is-eligible-and-in-what-order). |
| `prompt.system` | relative path | yes | Template file (see below). |
| `prompt.variables` | string list | yes | Every `{{var}}` referenced by the template must be declared here. |
| `policy` | object | yes | See below. |
| `capture` | boolean | no (default `false`) | **v2.** Local-only replay capture opt-in: every attempt's rendered variables + output text are written to the local SQLite `captures` table. Captures NEVER leave the machine — the exporter is structurally unable to read them (export-isolation test). |
| `cache` | boolean | no (default `false`) | **v2 (WS-C).** `cache: auto` stamps the per-provider cache directive on each attempt (gemini excluded); see [Caching lifecycle](caching-lifecycle.md). This is route-level automatic caching — distinct from the customer-owned explicit handle (`RunOptions.cache`). |
| `repair` | object | no | **v2.** Repair rung for the default variant — see below. |
| `variants` | list | no | **v2.** Named serving variants — see below. Absence = pure v1 semantics. |

## JSON Schema dialect

The `schema` file is validated with **Ajv**, configured for **JSON Schema
2020-12** as the primary dialect with **draft-07 also accepted** — a schema
declaring `"$schema": "…/2020-12/schema"` or `"…/draft-07/schema"` both compile
(the draft-07 meta-schema is registered explicitly). Author 2020-12 for new
schemas; existing draft-07 schemas keep working.

Two properties of the configuration are load-bearing when you author a schema:

- **Non-strict, union types allowed.** Unknown keywords do not fail compilation,
  and `"type": ["string", "null"]` is accepted.
- **`format` is annotation-only — it is NOT asserted.** Neither dialect enforces
  `format` without `ajv-formats`, which is not registered, so an `email`,
  `uri`, or `date-time` format documents intent but never rejects a value. If
  you need a value constrained, express it with `pattern` / `enum` /
  `minimum` / `maxLength`, not `format`.

The gateway and the probe harness (`packages/modelrig-probes`) build an
identical Ajv instance by design, so a fixture scores exactly as it serves.

## `policy`

| field | type | notes |
|---|---|---|
| `retries` | map | Per-failure-class retry budgets, e.g. `{ content_invalid: 2, network: 4, capacity_shed: 3 }`. Missing class = 0 retries. Budgets are non-fungible. Terminal classes (`budget_exhausted`, `invariant_violation`) are rejected here at load time. |
| `timeout_ms` | positive integer | Wall-clock deadline per attempt; breach maps to the `timeout` class. |
| `tier` | `standard` \| `flex` \| `priority` | Requested service tier. The tier actually served is recorded separately (`servedTier`) — silent downgrades become visible in telemetry. |
| `json` | `native` \| `json_mode` | Emission rung. `native`: candidates need native strict schema enforcement (`structured_native`); the schema goes to the provider natively. `json_mode`: candidates need either mechanism; the schema is additionally coached into the prompt with strict formatting guidance. |
| `sampling` | object | no | Declared sampling — `{ temperature?, top_p?, max_output_tokens? }`. Preserve exactly what the original call used. **Absent = every adapter keeps its own defaults** (Gemini runs at temperature 1.0); a call that relied on a specific temperature must declare it or its behaviour silently changes. Each field is optional and sent to the provider **as declared** (no clamp); ranges are validated at load — temperature `0`–`2`, top_p `(0, 1]`, max_output_tokens integer `≥ 1` — an out-of-range value is a config error. The block is **strict**: an unknown or misspelled key (e.g. `temperatur`, or camelCase `maxOutputTokens`) is a config error too, so a typo can't silently drop your sampling. `max_output_tokens` is the routed-lane exposure of the existing adapter cap. The route's sampling applies to the primary attempt AND its repair/extractor followups (one knob per route). |

```yaml
policy:
  timeout_ms: 60000
  tier: standard
  json: native
  sampling: { temperature: 0.1, max_output_tokens: 8192 }   # preserve the original call's sampling
```

> **Gemini 3 note.** Google recommends `temperature: 1.0` for Gemini 3 and warns
> that sub-1.0 values can loop / degrade on complex *reasoning* tasks
> (classification and extraction are typically fine). Declaring a sub-1.0
> temperature on a Gemini-3 candidate loads and is sent as declared, with a
> load-time advisory naming the model and value.

## Variants (bundle format v2 — Phase 3)

A route may declare `variants` — named bindings served via
`rig.run(route, { variant: "name" })`. Omitting `variant` (or passing
`"default"`) serves the route's base config exactly as v1 did; v1 bundles
remain valid unchanged. Every telemetry row records `served_variant`.

```yaml
variants:
  - name: cheap
    candidates:               # narrowing ONLY — must be ⊆ the route's list
      - provider: openai
        model: gpt-5.4-mini
    json: json_mode           # rung override for this variant
    repair:
      max_repairs: 2
      repair_model: openai/gpt-5.4-mini
  - name: scaffolded
    scaffold: |               # reasoning scaffold, appended before coaching
      Think through the drivers step by step before emitting JSON.
  - name: reworded
    prompt_override: ./prompts/echo-v2.system.md   # inline text also accepted
```

| field | notes |
|---|---|
| `name` | Unique per route; `"default"` is reserved for the base config. |
| `candidates` | Subset of the route's declared candidates — variants narrow, never widen (load error otherwise; the candidate-set invariant holds through variants). |
| `prompt_override` | Replaces the system template (rendered with the same variables + capability conditionals). Mutually exclusive with `prompt_append`. |
| `prompt_append` | Appended to the rendered system prompt. |
| `scaffold` | Reasoning-scaffold text appended after `prompt_append`, before json coaching. Manual authoring only this phase. |
| `json` | Rung override (`native` \| `json_mode`). |
| `repair` | Variant-level repair rung, overrides the route-level `repair`. |

## `repair` (the repair rung of the candidate ladder — Phase 3)

```yaml
repair:
  max_repairs: 2                     # 1 = retry-with-errors only; 2 adds the repair model
  repair_model: deepseek/deepseek-chat   # required when max_repairs is 2; must be a declared candidate
```

This is the repair rung of the candidate ladder — the ladder's rungs (resolve → render → dispatch → validate → repair → fall-through) are named in full on [Routing & reliability](routing-reliability.md#3-the-repair-rung-exactly).

On a schema-invalid output with repair enabled: attempt 1 re-asks the SAME
model with the ajv error summary appended; attempt 2 hands
`{invalid output, errors, schema}` to the designated repair model with a fixed
repair prompt. Repair attempts draw from their own `repair` budget (never the
`content_invalid` budget), and repaired rows carry `repaired_by` in telemetry
— repair cost is visible, not hidden.

## Requirement → capability mapping (registry-wired since Phase 3)

| requirement | satisfied by |
|---|---|
| `schema_conformant` + `json: native` | `structured_native` |
| `schema_conformant` + `json: json_mode` | `structured_native` OR `json_mode` |
| `grounded` | `grounded_native` (native directive on dispatch) OR a configured search provider (grounding-inject) |
| `trace_visible` | `trace_visible` (e.g. deepseek-reasoner's exposed reasoning_content) |
| `zero_retention` | `zero_retention` — a model the credential-scoped registry facts designate zero-retention under our managed account (a BYOK key is scoped separately). Opt-in; fail-closed when absent. |

Capability flags are resolved from **registry facts** (the packaged
`registry/registry.json`, env-overridable via `MODELRIG_REGISTRY_PATH`) with
per-flag precedence `capabilityOverrides > probed > declared` — a
probed-false trumps a declared-true (DeepSeek's declared schema support is
revoked because every probed sample served via json_mode coaching). Models
absent from the registry fall back to the adapter-static baseline below. This table is the registry-absent fallback for `gemini`, `openai`, and `deepseek`; a provider not shown here falls back to its own adapter's declared capability set.

| capability | gemini | openai | deepseek |
|---|---|---|---|
| `structured_native` | ✅ | ✅ | — |
| `json_mode` | ✅ | ✅ | ✅ |
| `grounded_native` | ✅ | — | — |
| `context_cache_explicit` | ✅ | — | — |
| `prompt_cache_key` | — | ✅ | — |
| `prefix_cache_implicit` | ✅ | ✅ | ✅ |
| `tier_flex` | ✅ | flex-eligible models only (no mini/nano) | — |

Overridable per provider via `RigConfig.capabilityOverrides` (replaces the
whole flag set for that provider — useful for pinning a route to one candidate
in tests).

## Templates

- `{{var}}` — substituted from `RunOptions.input`. Strings verbatim; objects
  and arrays are `JSON.stringify`ed; missing values throw.
- `{{#if capability.X}}…{{/if}}` / `{{#unless capability.X}}…{{/unless}}` —
  resolved against the SERVING candidate's flags before variable substitution.
  Flat only (nesting is a load-time error); unknown flags are load-time errors.
- The rendered template is sent as the system prompt; the user turn is a fixed
  terse trigger. Everything the task needs belongs in the template.

## Versioning discipline

The `(route, version)` pair keys the compiled validator cache, telemetry rows,
and the console's routes mirror. Editing a bundle without bumping `version`
makes telemetry lie across the change — bump every time.

## When it doesn't work

These are the load-time and first-run failures a bundle actually hits, in the
loader's own words. The first three fail LOUDLY (the bundle won't load); the
last fails SILENTLY (it loads and then behaves unlike the code it replaced) —
which is why it is the one to be most careful about.

- **`schema file not found: <path>`** — `schema:` names a JSON Schema file that
  isn't at that path. Paths resolve relative to the bundle file. Create the file
  there, or set `schema: null` for a genuinely free-form task.
- **`prompt.system file not found: <path>`** — same shape for the prompt
  template. Point `prompt.system` at where the file actually is.
- **`references undeclared variable "<name>"`** — the template (or
  `grounding.query`) uses a `{{name}}` that `prompt.variables` doesn't declare.
  Add it to the list, or fix the typo. This is caught at load so an empty slot
  can't ship silently. Note the ONLY conditional blocks the template engine
  supports are `{{#if capability.X}}` / `{{#unless capability.X}}` — a
  `{{#if <variable>}}` is not a feature and will not render.
- **A wrong `json: native`** — the bundle loads, then the run behaves unlike the
  code it replaced. `json: native` is a claim about the MODEL: set it only for a
  candidate whose registry entry shows probed native strict enforcement
  (`structured_native`). Otherwise omit it and let the emulation ladder handle
  structure. Check the probed registry (llms.txt or the MCP oracle) rather than
  recalling — declared and probed behaviour differ, which is the whole point.

Still stuck? Open an issue at <https://github.com/modelrig/modelrig/issues> — a
human reads them.

## Raw-lane provider × knob support (`rig.runRaw`)

> **Unreleased — workspace only (ships in 0.4.0):** `reasoning`
> beyond gemini, and `responseFormat`. The openai/grok prompt-cache hints are
> already true on the published package; the DeepInfra/Fireworks
> `prompt_cache_key` mapping ships in 0.4.0.

The Lane-B `rig.runRaw` seam forwards a set of provider knobs beyond the core
prompt/sampling ones. Each is ADDITIVE — absent ⇒ byte-identical dispatch — and
a knob a provider cannot honor FAILS CLOSED pre-dispatch (`RigFailureError`,
class `invariant_violation`; no meter, no provider call, no telemetry row),
never a silent drop. This table is the single source of truth: the runtime guard
(`assertRawKnobsSupported`) and this matrix are both generated from the same
`RAW_KNOB_SUPPORT` table, so what you read here is exactly what the guard
enforces.

<!-- RAW_KNOB_MATRIX -->

Ask it in code instead of duplicating this table: `rawKnobSupport(provider)`
returns the row above, and `GEMINI_THINKING_CAPABLE_MODELS` is the exported set
the gemini reasoning gate uses (both from the package root).
