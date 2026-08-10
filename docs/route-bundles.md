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
| `candidates` | list | yes, non-empty | THE candidate set. Each entry is `{provider, model}`. Providers: `gemini`, `openai`, `deepseek` (`anthropic`, `grok` reserved). Nothing outside this list can serve the route — enforced structurally (branded `CandidateRef`) and at runtime. |
| `require` | list | no | Hard constraints: `schema_conformant`, `grounded`, `zero_retention`, `trace_visible` (v2 — reasoning trace exposed to the caller). `grounded` is satisfied natively OR — when a search provider is configured — via the grounding-inject rung (search results injected into the prompt, citations normalized onto `RunMeta.citations`, search cost accounted). `zero_retention` is an **opt-in data-governance filter** (G-3): it routes only to zero-retention–designated endpoints, and fails closed (no designated candidate → the no-eligible-candidate error, never a silent non-ZDR dispatch). A single run can opt in without editing the bundle via `RunOptions.zeroRetention: true`. |
| `prefer` | list | no | Advisory ordering: `cost` (ascending via the pricing snapshot; unknown cost sorts last), `latency` (no-op until probe data exists, Phase 2). |
| `prompt.system` | relative path | yes | Template file (see below). |
| `prompt.variables` | string list | yes | Every `{{var}}` referenced by the template must be declared here. |
| `policy` | object | yes | See below. |
| `capture` | boolean | no (default `false`) | **v2.** Local-only replay capture opt-in: every attempt's rendered variables + output text are written to the local SQLite `captures` table. Captures NEVER leave the machine — the exporter is structurally unable to read them (export-isolation test). |
| `repair` | object | no | **v2.** Repair rung for the default variant — see below. |
| `variants` | list | no | **v2.** Named serving variants — see below. Absence = pure v1 semantics. |

## `policy`

| field | type | notes |
|---|---|---|
| `retries` | map | Per-failure-class retry budgets, e.g. `{ content_invalid: 2, network: 4, capacity_shed: 3 }`. Missing class = 0 retries. Budgets are non-fungible. Terminal classes (`budget_exhausted`, `invariant_violation`) are rejected here at load time. |
| `timeout_ms` | positive integer | Wall-clock deadline per attempt; breach maps to the `timeout` class. |
| `tier` | `standard` \| `flex` \| `priority` | Requested service tier. The tier actually served is recorded separately (`servedTier`) — silent downgrades become visible in telemetry. |
| `json` | `native` \| `json_mode` | Emission rung. `native`: candidates need native strict schema enforcement (`structured_native`); the schema goes to the provider natively. `json_mode`: candidates need either mechanism; the schema is additionally coached into the prompt with strict formatting guidance. |

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

## `repair` (ladder rung 4 — Phase 3)

```yaml
repair:
  max_repairs: 2                     # 1 = retry-with-errors only; 2 adds the repair model
  repair_model: deepseek/deepseek-chat   # required when max_repairs is 2; must be a declared candidate
```

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
absent from the registry fall back to the adapter-static baseline below:

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
