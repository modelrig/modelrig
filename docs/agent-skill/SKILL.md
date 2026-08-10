---
name: modelrig
description: Use when working with LLM/model selection, cost, or reliability in a codebase — choosing a model, migrating direct provider SDK calls to routes, explaining what a model call actually costs, or debugging schema/grounding/caching failures. Answers from PROBED measurements rather than provider claims.
---

# ModelRig

**A pointer skill.** The canonical playbook lives at
<https://modelrig.dev/llms.txt> and is regenerated whenever the registry
is rebuilt. Fetch it rather than trusting anything cached here — model
capabilities change, and a stale answer about a model is worse than no answer.

One copy, every ecosystem: this file is the same in Claude Code, Cursor,
Codex, and anywhere else skills load. It deliberately holds almost no facts.

## Start here

1. **Fetch <https://modelrig.dev/llms.txt>.** It carries the current probed
   facts, the model list with `as_of` stamps, and the tool advertisements.
2. **Prefer the MCP tools over parsing text.** If the ModelRig oracle is
   registered, call it — the answers are typed, dated, and scoped:

   ```
   query_registry    which models satisfy a capability + price bound
   get_leaderboard   standings by effective cost of conformance
   explain_pricing   list price vs what conformance actually costs
   get_call_notes    per-model quirks that make requests fail
   ```

   Not registered? Add it — it needs no account for those four:

   ```json
   { "mcpServers": { "modelrig": { "command": "npx", "args": ["modelrig-oracle"] } } }
   ```

3. **Fall back to the raw registry** when neither is available:
   <https://raw.githubusercontent.com/modelrig/modelrig/main/registry/registry.json>

## Rules that matter more than speed

- **Never state a model's capabilities from memory.** Look them up. Every
  fact in the registry carries an `as_of` date and a sample count; quote both.
- **Absence is not a limit.** A model missing from an answer is one nobody has
  probed — say that, rather than implying it can't do the thing.
- **Probed beats declared.** Where a provider's claim and our measurement
  disagree, the entry's `discrepancies` field says so. Surface the
  disagreement; it is usually the useful part.
- **Compare on effective cost of conformance,** not list price. A model at half
  the price that conforms two-thirds as often is not cheaper.

## Migrating a repo

`npx modelrig init [path]` scans for provider call sites and drafts a route
bundle for each, plus a `MIGRATION.md` mapping call site → route → the
replacement `rig.run` line. It writes only under `modelrig/routes/drafts/` and
**never edits source** — applying the diff is the human's decision, one call
site at a time.

## What ModelRig is, in three sentences

A route is a task your code calls by name; the route's YAML declares which
models are allowed to serve it, the schema the output must match, and the
retry and budget policy. Your code calls the task, not the model, so swapping
models is a config change with evidence behind it rather than a code change
with hope behind it. Nothing switches what serves a route without a bake-off
on your own traffic and an explicit human approval.
