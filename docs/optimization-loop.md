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

## 6. The Rig Analyst (scheduled — `modelrig-analyst` cron)

The watch loop reacts to *price* moves; the **Rig Analyst** reads the *lake*.
Once a day it scans each org's trailing 7-day window — runs, their
`run-outcome@v1` verdicts (pass/fail + dominant failure class), and feedback —
and hands back what it found **as proposals**, through the exact same
machinery every other proposal rides (same table, same
`(org, route, trigger_hash)` idempotency, same human gates). There is no
second store and no new "findings" object: the Analyst's findings ARE
proposals, and the console's Insights page is a view over them.

**It only clusters what it can measure.** A cluster is an auditable group-by —
a task's failure concentration (`fail:<class>`) or its feedback down-rate — and
it REPORTS only when it clears a salience bar:

- `ANALYST_MIN_RUNS = 10` — the task has enough activity in the window, AND
- a failure cluster stands `ANALYST_FAIL_PTS = 20` points above the org's
  window-wide fail rate, OR a feedback cluster clears
  `ANALYST_DOWN_RATE = 0.3` over `ANALYST_MIN_FEEDBACK = 5` signals.

Below the bars it says **nothing** — silence on thin or healthy data is the
correct answer, not a gap. Free-form/LLM clustering is deliberately out of
scope; v1 clusters are group-bys a human can re-derive by hand.

Each reporting cluster becomes one `insight` proposal (with exemplar run ids
and a 14-day expiry — insights rot rather than accumulate). A failing cluster
whose exemplar runs carry promotable failing artifacts additionally raises one
`promote-eval` proposal (≤ `ANALYST_PROMOTE_MAX = 20` candidates); a cluster on
a route with a cheaper declared challenger additionally raises an
Analyst-initiated `bakeoff`.

**Summaries are optional and bounded.** When a judge credential
(`MODELRIG_JUDGE_*`) is configured, the Analyst makes ONE model call per NEW
cluster to write a two-sentence plain-language summary into the insight's
evidence — riding the `analyst-summarize@v1` gateway route (metered,
spend-stopped) and sharing the judge's per-org daily cap. Absent that
credential, a deterministic template summary is used; the cycle never depends
on a model.

Approving a `promote-eval` batch on the Insights page executes the promotes
through the existing eval-case path (§2's machinery) and records the honest
per-candidate result. A `swap` finding renders a **copyable PR body** plus a
`gh pr create` one-liner — ModelRig computes it, but you open the PR and a
human merges it. The Analyst never actuates anything.

## Console surfaces

`/insights` (the Analyst's findings board + the quality-trend Monitor band) ·
`/proposals` (the queue, evidence-first) · `/coverage` (rungs + category
percentiles) · `/costs` (the odometer). All read-only except the human-gated
decisions; every route change renders as a copyable PR body / CLI command.
