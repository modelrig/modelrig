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
> resource has a lifetime. A multi-hour pipeline outlives the provider's default
> TTL. ModelRig will **not** refresh or recreate your cache for you — by design
> (see "Who owns what"). If your job runs longer than the TTL, your code must
> refresh or recreate the resource, or every call after expiry silently pays the
> full uncached price.

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
  provider an identifier it would reject). On the Lane-B `runRaw` seam the same
  field rides on the raw input: `rig.runRaw({ provider, model, …, cache: { key } })`.
- **Run a TTL heartbeat for long jobs.** This is the load-bearing one. The cache
  has a default TTL (Gemini's is best-effort and undocumented — treat it as
  short). A pipeline that runs for hours will cross it. **ModelRig does not refresh
  or recreate the resource** — so your code must: extend the TTL on a timer, or
  recreate the resource and swap the handle you pass in. Without a heartbeat, the
  first call after expiry gets a `cache_invalid` failure (ModelRig then retries
  that candidate *without* the handle — a correct but full-price call), and every
  call after pays uncached.
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
  If you route across models, see the cache-aware routing docs: warmth is tracked
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
  large bill; if the after-cost jumped, the cache is not engaging.
- **Trust the miss-streak alert as the net, not the plan.** ModelRig's `cache:
  auto` guard and the miss-streak alert catch what your inventory missed — but they
  are the backstop, not a substitute for passing the handle correctly in the first
  place.

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
