# Provider caching — the lifecycle your integration owns

> **Written for the coding agent doing the integration.** If you are migrating a
> pipeline that already caches (a Gemini `cachedContents` handle, an Anthropic
> `cache_control` block, an OpenAI `prompt_cache_key`), read this before you
> write a single route. The one thing that silently costs money is dropping a
> cache you used to have — and the one thing that silently *breaks* a cache is
> letting it expire under a long job. ModelRig passes your cache handle through
> and **accounts for the hits**; it never creates, refreshes, or deletes the
> underlying resource. That lifecycle is yours. This page teaches you how to own
> it.

The headline, up top so you cannot miss it:

> **Long cached runs need a TTL heartbeat, and your code owns it.** A cache
> resource has a lifetime. A multi-hour pipeline outlives whatever TTL you set.
> ModelRig will **not** refresh or recreate your cache for you — by design
> (see "Who owns what"). If your job runs longer than the TTL, your code must
> refresh or recreate the resource. Otherwise the first call after expiry fails
> `cache_invalid` (ModelRig retries it without the handle — correct result,
> full price) and every call after pays uncached. The run keeps succeeding;
> the failure mode is **cost**, and the miss-streak alert is how you notice.

Terms this page leans on: a **route** (also called a task — the named unit
`rig.run("my.task")` serves, defined in a route-bundle YAML) lists **candidate**
models it may dispatch to, in order. Shapes and options:
[route bundles](route-bundles.html) · [quickstart](quickstart.html). The
migration protocol that sends you here — including the **C2 caching inventory**
you run before writing any route — is the
[migration playbook](migration-playbook.html).

## The three caching regimes

Providers cache in three fundamentally different ways. Which regime a model uses
decides whether *anybody* owns a lifecycle at all.

| Regime | Providers (v1 registry) | Who engages it | Who owns a lifecycle |
|---|---|---|---|
| **Automatic prefix** | OpenAI, DeepSeek, Grok, Fireworks, Gemini (implicit) | Nobody — the provider caches the longest repeated prefix with no request change | Nobody. Just don't break the prefix (see "Prefix hygiene") |
| **Marker** | Anthropic (`cache_control`) | The request marks a cache breakpoint; no marker, no cache | ModelRig, via `cache: auto` on the route — you do nothing |
| **Explicit resource** | Gemini (`cachedContents`) | You create a named resource up front and reference it by handle | **You.** Create it, heartbeat it, recreate it on change, delete it when done |

The first two regimes need nothing from you beyond a stable prompt prefix and, for
Anthropic, opting the route into `cache: auto`. The third — Gemini's explicit
`cachedContents` — is the only one where a resource with a *lifetime* exists that
somebody has to manage. That somebody is you, and the rest of this page is mostly
about that case, because it is the one that bit the first migration.

## One directive, provider-appropriate meaning

There is exactly **one** cache field on the customer surface —
`rig.run(task, { input, cache: { key, provider } })` and the Lane-B
`rig.runRaw({ …, cache: { key } })`. It is deliberately **provider-neutral**: the
adapter maps the same `key` to whatever the named provider's caching mechanism
actually is. There is **no** separate `promptCacheKey` field — one directive,
appropriate meaning per provider, zero churn for gemini callers:

| Provider(s) | What `cache.key` means | Retention |
|---|---|---|
| **Gemini** | a **resource HANDLE** — the `cachedContents/<id>` you created and own | your TTL heartbeat (this page) |
| **OpenAI** | a **routing HINT** — `prompt_cache_key` (keeps the prefix cache warm) | `cache.ttlSeconds ≥ 86400` → `prompt_cache_retention: "24h"` |
| **Grok** | a **routing HINT** — `prompt_cache_key` | provider-managed |
| **DeepInfra / Fireworks** | a **routing HINT** — `prompt_cache_key` _(ships in 0.4.0)_ | provider-managed |

The Gemini/OpenAI/Grok rows are true on the published package; the
DeepInfra/Fireworks `prompt_cache_key` mapping ships in 0.4.0 (until then those
hosts ignore the key — a documented, not silent, difference).

On the HINT providers the key never names a resource you have to create or delete
— it only helps the provider route repeated calls to a warm cache. So the
cost-accounting and cache-key **provenance** rules are identical across all of
them: a customer-supplied `cache.key` reads as `customer` provenance (the raw lane
runs no prefix fingerprinting), and cache-read tokens bill at the read rate the
same way everywhere. Only the **Gemini HANDLE** case carries a lifecycle you own —
which is the rest of this page.

> For the raw lane, which provider honors which of these (and the other knobs —
> grounding, reasoning, responseFormat) is the
> [provider × knob matrix](route-bundles.html#raw-lane-provider-knob-support-rigrunraw).

## Explicit-cache lifecycle (Gemini `cachedContents`) — customer-owned

You already have this code if you engineered explicit caching; ModelRig changes
only how you *reference* the handle at call time. The full lifecycle, in order:

- **Create the resource** from your stable content (the big, unchanging prefix —
  a long system prompt, a document corpus, a tool schema) using the Gemini SDK,
  as you do today. Note a Gemini rule that surprises people: **`systemInstruction`
  and `tools` are BAKED INTO the cache at creation.** A request that sets
  `cachedContent` *and* a system instruction or tools is rejected by the API —
  they already live in the cache. So the `googleSearch` tool for a cached
  grounded step, and the system prompt, are fixed at create time.
- **Reference the handle per call** through your route. ModelRig carries a
  customer-supplied handle straight to the provider:

  ```ts
  const { output } = await rig.run("my.task", {
    input: { … },
    tags: { run_id },
    cache: { key: "cachedContents/abc123", provider: "gemini" },
  });
  ```

  `provider` is **required** — the handle names a Gemini resource, so ModelRig
  applies it only to Gemini candidates. A fallback candidate on another provider
  dispatches *without* the handle (an uncached correct call beats handing a
  provider an identifier it would reject). If losing the cache on fallback is
  unacceptable for your economics, pin the route: a route whose candidates are
  all the one Gemini model never falls elsewhere. On the Lane-B `runRaw` seam
  the same field rides on the raw input:
  `rig.runRaw({ provider, model, apiKey, …, cache: { key } })` (runRaw is BYOK —
  pass your provider key).

  **Grounded + cached on the
  raw lane.** When a `runRaw` step declares both `grounding: { mode: "native" }`
  and a `cache.key`, ModelRig needs **no** special handling: the cached path
  already drops `tools`, so the `googleSearch` tool must be **baked into the
  cache resource at creation** (as above). Create the cache *with* the
  `googleSearch` tool, pass its handle plus `grounding: { mode: "native" }`, and
  grounding fires against the cached prefix with the cached-token ratio intact.
  A grounded `runRaw` step **without** a `cache.key` gets the `googleSearch` tool
  attached on the request as usual.

  **You do not need to empty your route's template when you pass a handle.**
  When `cache.key` is set on a Gemini dispatch, ModelRig automatically drops
  `systemInstruction` and `tools` from the request — the API requires it, and
  the adapter handles it. The flip side is load-bearing: the dispatched request
  then carries **only what the cache contains**, so the resource must have been
  created *with* the system content and tools the task depends on. A handle
  whose cache lacks your system prompt does not error — it answers without it.
- **Run a TTL heartbeat for long jobs.** This is the load-bearing one. An
  explicit `cachedContents` TTL is **yours to set at create time** (`ttl` —
  Google's documented default is 1 hour; storage bills per token-hour while it
  lives). Only the *implicit* cache's lifetime is best-effort and undocumented.
  A pipeline that runs for hours will cross whatever you set. **ModelRig does
  not refresh or recreate the resource** — so your code must: extend the TTL on
  a timer, or recreate the resource and swap the handle you pass in. The whole
  heartbeat is one SDK call on an interval:

  ```ts
  // Gemini SDK: extend the TTL while the job runs (interval << ttl)
  const beat = setInterval(
    () => ai.caches.update({ name: handle, config: { ttl: "3600s" } }),
    20 * 60_000,
  );
  // clearInterval(beat) + ai.caches.delete({ name: handle }) when the job ends
  ```

  `cache.key` is read fresh on every `rig.run` call, so recreating the resource
  and swapping the variable you pass takes effect on the next call — no restart.
  Without a heartbeat, the first call after expiry gets a `cache_invalid`
  failure (ModelRig then retries that candidate *without* the handle — a
  correct but full-price call), and every call after pays uncached. The drop
  lasts for that candidate's retries **within the run**; a later `rig.run`
  call tries the handle again (and fails the same way if it is still expired) —
  when a handle is gone, recreate it or stop passing it.
- **Recreate on any change.** A cache is bound to its exact content. Change the
  system template, the tool schema, or the corpus by even one token and the old
  handle no longer matches your new prefix — create a fresh resource and pass the
  new handle. (See "What invalidates a cache".)
- **Delete when done.** Explicit caches bill for storage per token-hour while they
  live. Delete the resource when the job finishes so you stop paying to store a
  prefix nobody will read again.

## What invalidates a cache

A cache is a bet that the next request's prefix is byte-identical to a previous
one. Anything that changes the prefix loses the bet — silently, with no error,
just a full-price call:

- **Model swap.** Caches are **model + version scoped**. A router that switches
  the serving model — including a same-provider fallback to a *different* Gemini
  model — starts cold, and an explicit Gemini handle bound to the old model fails
  `cache_invalid`. (This is exactly why ModelRig drops the handle on the retry.)
  If you route across models, see [Routing & reliability](routing-reliability.md) (§9 and the boundary §10): warmth is tracked
  per candidate, and a cold switch is a known, measured cost.
- **Template edits.** Any change to the system prompt prefix.
- **Tool-schema changes.** For Gemini, tools are baked into the cache; a schema
  edit means a new resource.
- **Reordered context.** Prefix caching matches from the *front*; moving a stable
  block later, or a volatile block earlier, breaks the match.
- **Timestamps (or any per-run value) in the prefix.** The classic silent
  cache-killer: a `Generated at <ISO timestamp>` line near the top makes every
  request's prefix unique. Push volatile values to the end.

## Prefix hygiene

Two rules cover almost everything:

- **Stable content first, volatile content last.** Constitution, corpus, schema,
  long instructions up front; the per-call question, the timestamp, the run id at
  the very end. This maximizes the shared prefix every regime caches on.
- **Clear the minimum cacheable length.** Below a provider's minimum prefix,
  caching silently does not engage — no error, no cache, full price. The minimums
  are versioned data in the **CachePolicy registry**
   (`src/registry/cache-policy.ts`, `min_cacheable_tokens`, sourced first-party
   with an `as_of` stamp — the registry governs, not this prose). As of the
   2026-08-18 policy snapshot: DeepSeek engages at ~64 tokens, OpenAI and Anthropic
   at ~1,024, and Gemini's implicit cache at ~4,096; Grok and Fireworks publish no
   documented minimum. If your stable prefix is shorter than the minimum, it will
   not cache no matter what you do — make the cacheable content bigger or accept
   that the route is uncacheable.

## Verify, don't assume — the week-one checklist

Caching fails quietly, so the only honest confirmation is to look at the numbers
on real traffic. After your first production runs:

- **Open the route's cache-hit-rate panel** in the console. A route that cached
  before migration and now shows a **zero hit rate is a regression** — say so, and
  find which of the invalidators above you tripped.
- **Compare cost before and after.** A cached 170K-token prompt at ~98% hit is a
  large *saving* on every call; if the after-cost jumped, the cache is not
  engaging and you are paying the bill it used to avoid.
- **Check the route actually opted in.** Anthropic's marker regime does nothing
  without `cache: auto` on the route — a route that forgot the opt-in silently
  gets zero caching, which is exactly the regression class this page exists to
  prevent.
- **Trust the miss-streak alert as the net, not the plan.** The miss-streak
  alert is the console health signal that fires when a cache-opted route's
  recent calls all report zero cached tokens; together with the `cache: auto`
  stamping guard it catches what your C2 caching inventory (migration playbook)
  missed — but they are the backstop, not a substitute for passing the handle
  correctly in the first place.

## Who owns what (the design line)

- **You own** the cache resource and its lifecycle: create, TTL heartbeat,
  recreate-on-change, delete. This is ruled, not incidental — a cache lifetime is
  application state that only your code knows the shape of (how long the job runs,
  when the corpus changes), so keeping it customer-side is the correct boundary,
  not a gap.
- **ModelRig owns** carrying your handle to the provider unchanged and
  **accounting for the hits** — cache-read tokens are captured and priced at the
  read rate, so the savings show up in your telemetry and bake-offs. It never
  creates, refreshes, or deletes the resource.

Managed cache lifecycle (ModelRig creating and heartbeating the resource for you)
is deliberately *not* in v1 — it is revisited only if it offers real customer
value over you owning the resource you already understand.

## Where to go next

- [Migration playbook](migration-playbook.html) — the checkpoint protocol,
  including the C2 caching inventory this page backstops.
- [Route bundles](route-bundles.html) and [quickstart](quickstart.html) — route,
  candidate, and `rig.run` option shapes.
- Google's context-caching reference (create / update / delete, TTL semantics):
  https://ai.google.dev/gemini-api/docs/caching — the API your heartbeat calls.
