# Bake-offs, replay & capture

"Can a cheaper model do this step?" — answered with measurements, not vibes.
A **bake-off** replays your own captured traffic through named route
[variants](./route-bundles.md) and produces the conformance matrix: per
variant, conformance rate with a Wilson 95% interval, repair rate and repair
cost, latency, and the headline — **effective $ per 1K conformant outputs**
(total spend ÷ conformant outputs × 1000, including retries, repair calls,
and search costs).

## 1. Capture (local-only — the privacy invariant)

Replay needs inputs. Opt a route in per bundle:

```yaml
capture: true
```

Every attempt then writes `{rendered variables, output text}` to the local
SQLite `captures` table.

**Captures never leave the machine.** This is structural, not policy: the
telemetry exporter's store interface has no capture accessors — there is *no
code path* from captures to any network sink — and a runtime
export-isolation test asserts no sink payload ever carries capture content.
The cloud schema deliberately has no captures table. What does mirror: the
per-route `capture` flag (status only) and bake-off aggregate metrics.

## 2. Replay

```ts
const samples = await rig.replay("research.growth_scenarios", {
  variant: "cheap",
  lastN: 50,
  envelopeUsd: 10, // hard cap for the whole pass
});
```

Replay re-renders the **captured variables** through the variant's template
against the replay candidate's capability flags (never the captured prompt
text — a variant with different capabilities must render as it would serve).
Replay calls are real, billed calls: envelope-guarded, tagged into the
`replay:<id>` tag namespace (production tag queries never see them), and
never written back to captures.

## 3. Bake-off

```bash
modelrig bakeoff --route research.growth_scenarios \
  --variants default,cheap,scaffolded --replay-last 50
```

`default` is the route's base config. Output: the matrix on stdout, an
artifact JSON under `.modelrig/bakeoffs/`, and (when the Supabase sink is
configured) a row in the `bakeoffs` mirror rendered by the console's
`/bakeoffs` view. Also available over HTTP: `POST /bakeoff/:route` returns
`202` + a poll URL (`GET /bakeoff/:id`).

## 4. Proposals are proposals

A variant **proposes** when its conformance CI lower bound is at least the
incumbent's and its effective cost is strictly lower. The artifact records
the winner and the savings percentage — and that is all it does. **Model
swaps in production are a human decision**: nothing in the bake-off path
mutates routing, and value-accuracy gates beyond mechanical conformance
arrive with the Phase 4 judge work.
