# The MCP oracle

> **Unreleased.** `modelrig-oracle` is not yet published to npm — the
> `npx modelrig-oracle` commands on this page work from the workspace build
> only, and will work everywhere once the oracle ships its first release
> (tracked as the oracle-release mini-mission). Nothing else on this site
> depends on it: llms.txt carries the same probed facts as plain text.

**What it is:** an MCP server that lets a coding agent ask what models can
actually do — measured, dated, and priced by what conformance really costs —
and then act on the answer.

**Why it exists:** the fastest path from "which model should serve this?" to a
working route runs through the agent already sitting in your editor. Asking it
to read a docs page and hope is worse than giving it a tool.

```bash
npx modelrig-oracle          # stdio; this is the whole install
```

Register it once:

```json
{ "mcpServers": { "modelrig": { "command": "npx", "args": ["modelrig-oracle"] } } }
```

---

## Read tools — no account, no key

These answer from the packaged registry. Nothing leaves your machine except an
anonymous record of the question's *shape* (see [Demand signal](#demand-signal)).

| Tool | Answers |
|---|---|
| `query_registry` | "Which models can serve strict JSON under $1/M?" — capability predicates plus a price bound, ranked by effective cost of conformance. |
| `get_leaderboard` | Standings, optionally for one capability. Cheap-but-unreliable ranks below pricier-but-correct, because the ranking is cost per *conformant* output. |
| `explain_pricing` | List price for one model, the effective cost of conformance beside it, and why they differ. |
| `get_call_notes` | Per-model call-shaping quirks: parameters it rejects, shapes it needs, defaults that surprise. Plus any measured disagreement with the provider's claims. |

Every answer carries `scope`, `probe_data_as_of`, `models_in_registry`, and a
staleness flag. When nothing matches, the answer explains *why* rather than
returning an empty list — the difference between "no such model" and "we
haven't measured one" is the whole point.

### The four capability predicates

| Predicate | Means |
|---|---|
| `structured-native` | The provider enforces your JSON Schema on its side — probed native rung rate above zero. |
| `structured-coached` | Output matched the schema on at least 90% of probed samples, whether or not the provider enforced it. |
| `grounding` | At least half of probed answers cited real retrieved sources rather than answering from memory. |
| `caching` | Repeat calls actually reported cached input tokens — a measured discount, not a claim. |

## Act tools — token-scoped

Set `MODELRIG_ORACLE_TOKEN` to enable these. Each is narrower than it sounds,
on purpose.

| Tool | Does | Never does |
|---|---|---|
| `get_proposals` | Lists open swap suggestions the watch loop opened for your routes, with evidence and savings. | Change anything. |
| `create_route` | Writes a **draft** route bundle — YAML, schema, prompt — into your drafts directory, candidates seeded from the registry, your current model first. | Edit your source, register a route, overwrite an existing draft. |
| `test_route` | Makes **one** real billed call through a route, under a fresh budget envelope (default $1). | Run unbounded. |
| `run_bakeoff` | Replays captured inputs through challenger variants, each arm under its own envelope (default $2). | Switch what serves your route. |

**Budget envelopes are not optional.** Every spending tool either takes a cap
or gets the default, and refuses anything above $25 per call — larger spends
belong at a CLI where a human is present for the decision.

**`create_route` writes files and nothing else.** No control-plane mutation, no
source edits, no silent registration. A draft is a proposal you read.

## Demand signal

Every call logs one row: which tool, which capability or model was asked about,
and whether we had an answer. That is the entire payload — no prompts, no
schemas, no question text, and on stdio no account linkage at all (the session
key is random per process and resolves to nobody).

Unmatched rows are the point. They tell us which models people need that we
haven't probed, which is how the coverage queue gets prioritized. If you want
to make that signal louder for a specific model, file a
[probe request](./probe-request.md).

## When the oracle disagrees with the console

It shouldn't — both answer from the same selection module, deliberately, so
that "which models can do X" has exactly one implementation. If you ever see
them differ, that's a bug worth reporting.
