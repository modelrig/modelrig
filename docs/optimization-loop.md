# The continuous optimization loop

The landscape never sits still — models reprice weekly and new ones land
monthly. The loop turns that churn into measured savings:

**watch → proposal → evidence → human-approved swap → odometer.**

Nothing in this loop executes on its own. Every arrow that changes what
serves production runs through your terminal and your git history.

## 1. Watch (`modelrig watch run`, cron it daily)

One cycle diffs the current pricing map against the last-seen snapshot
(`.modelrig/watch-state.json`), restricted to providers your routes declare.
Two event classes:

- **price change** — a candidate's blended cost moved ≥ the threshold
  (`MODELRIG_WATCH_THRESHOLD_PCT`, default ±10%),
- **new model** — an unseen entry on a provider you already use.

Material events become **proposal** rows (suggested bake-offs) on the
control plane. Idempotent per (route, trigger-hash): re-running a cycle
never duplicates a proposal. Proposals expire after 30 days — decisions
ride current data. The first run seeds state silently.

Fixture injection for testing: `modelrig watch run --events fixtures.json`.

## 2. Evidence (`modelrig bakeoff --from-proposal <id>`)

Runs the bake-off the proposal suggests — your route's variants over your
own captured traffic — and attaches the matrix to the proposal
(`suggested → evidenced`). Paid runs draw from the monthly watch envelope
(`MODELRIG_WATCH_MONTHLY_USD`, default $50): when it's spent, the loop
stops proposing paid work until next month. Typed stop, never an overrun.

## 3. Decision (`modelrig swap execute <proposalId> --approve`)

Human, explicit, recorded. The command:

1. requires `--approve` — there is no auto-execute path;
2. **emits the route-YAML change** — you apply it via git; the executor
   never edits route files ("the console shows the truth; actions live in
   your code");
3. records a `swap_events` row with the incumbent's baseline snapshot;
4. prints the revert command (`modelrig swap revert <swapId>`).

## 4. The odometer

Verified savings per swap =
`(baseline effective $/conformant − actual $/conformant since swap) × conformant volume`.

Rules the number lives by: **measured only, never projected**; failed-
attempt spend counts against it; unpriced rows are excluded; reverted swaps
stop accruing; negative results show as negative. When in doubt, it
undercounts. Rendered on the console's `/costs` page.

## 5. Your exhaust is your data (`POST /query`)

The server exposes a read-only, SQL-ish query surface over your own
telemetry rows:

```
SELECT tag.client, sum(cost) FROM inferences
WHERE ts >= '2026-07-26' GROUP BY tag.client
```

Allowlisted grammar only — known columns (`route`, `provider`, `model`,
`ts`, `failure_class`, `served_variant`, `tag.<name>`), five aggregate
functions, `AND`-only conditions, bind-parameter literals. Raw SQL never
passes through, by construction. Tokens can be row-scoped
(`MODELRIG_QUERY_TOKENS=<token>=tag:client:acme`) — the scope is ANDed into
every query the token runs.

## Console surfaces

`/proposals` (the queue, evidence-first) · `/coverage` (rungs + category
percentiles) · `/costs` (the odometer). All read-only; every action renders
as a copyable CLI command.
