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
| `require` | list | no | Hard constraints: `schema_conformant`, `grounded`, `zero_retention` (validated in Phase 1; `zero_retention` is declared intent until the registry lands). |
| `prefer` | list | no | Advisory ordering: `cost` (ascending via the pricing snapshot; unknown cost sorts last), `latency` (no-op until probe data exists, Phase 2). |
| `prompt.system` | relative path | yes | Template file (see below). |
| `prompt.variables` | string list | yes | Every `{{var}}` referenced by the template must be declared here. |
| `policy` | object | yes | See below. |

## `policy`

| field | type | notes |
|---|---|---|
| `retries` | map | Per-failure-class retry budgets, e.g. `{ content_invalid: 2, network: 4, capacity_shed: 3 }`. Missing class = 0 retries. Budgets are non-fungible. Terminal classes (`budget_exhausted`, `invariant_violation`) are rejected here at load time. |
| `timeout_ms` | positive integer | Wall-clock deadline per attempt; breach maps to the `timeout` class. |
| `tier` | `standard` \| `flex` \| `priority` | Requested service tier. The tier actually served is recorded separately (`servedTier`) — silent downgrades become visible in telemetry. |
| `json` | `native` \| `json_mode` | Emission rung. `native`: candidates need native strict schema enforcement (`structured_native`); the schema goes to the provider natively. `json_mode`: candidates need either mechanism; the schema is additionally coached into the prompt with strict formatting guidance. Rungs 3–4 (repair) arrive in Phase 3. |

## Requirement → capability mapping (Phase 1 static stub)

| requirement | satisfied by |
|---|---|
| `schema_conformant` + `json: native` | `structured_native` |
| `schema_conformant` + `json: json_mode` | `structured_native` OR `json_mode` |
| `grounded` | `grounded_native` (also flips the grounding directive on dispatch) |

Static capability flags per provider (probed registry replaces this in Phase 2):

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
