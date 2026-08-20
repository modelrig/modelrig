# Run verdicts — was the whole run good?

A single model call either conformed to its schema or it didn't; a whole **run**
— a pipeline of steps and the artifacts they produced — needs a verdict of its
own. ModelRig attaches two kinds, and keeps them honest by keeping them apart:
one is computed, free, and automatic; the other calls a model, costs money, and
never fires on its own.

## run-outcome@v1 — deterministic, automatic

When a run ends, ModelRig writes one `run-outcome@v1` verdict with **no model
call**. It **passes** iff all three hold:

1. the run **succeeded** (a running, failed, or abandoned run never passes);
2. no step's latest attempt carries a `failure_class`;
3. every deterministic artifact evaluation in the run passed.

Otherwise it **fails**, and the verdict's `label` names the dominant failure —
the most frequent step failure class, else the run's non-succeeded status, else
`failed-evaluation`. Same inputs, same verdict, every time: it is a pure
function over columns the run graph already carries, so it costs nothing and
never disagrees with itself. This is the measured floor — a verdict you have
before any judge is involved.

## run-judge@v1 — a model judge, explicit and bounded

Some questions ("did this run actually achieve the outcome?") a deterministic
check can't answer. For those there is one built-in model judge, `run-judge@v1`:
it reads the run's step/artifact summary (metadata, declared schemas, and the
deterministic verdicts; content only where custody grants it) and scores
outcome-achievement 0–1 with an explanation, written as a `model-judge`
evaluation.

It is deliberately fenced in:

- **Explicit only.** It runs when you ask — the console's judge button
  (admin/owner) or `modelrig judge <runId>` — and **never** on a schedule or
  automatically. There is no background judging.
- **Metered and routed.** The judge *is* a route: the scoring call rides the
  gateway like any other, so it is priced, budgeted, and spend-stopped the same
  way, and every invocation is a counted, metered event.
- **Capped per org, per day.** A conservative daily cap bounds spend; past it
  the call refuses with a typed error (`429`) rather than run up a bill.

```bash
modelrig judge run-123      # score one run with the bounded judge; explicit + metered
```

## Attach your own (`rig.run.evaluate`)

Your own code can attach a run-level evaluation — the run-subject mirror of
`artifact.evaluate`:

```ts
rig.run.evaluate({
  evaluator: "my-checker",
  kind: "deterministic",   // "deterministic" | "model-judge" | "human"
  passed: true,
  score: 0.9,
  label: "on-time",
  explanation: "all figures tied out",
});
```

It attaches to the active run. A run handle carries the same method
(`handle.evaluate(...)`), which works even after the run has ended — verdicts
are often post-hoc. With the artifact namespace off it is an inert no-op, never
an error on your path.

## On the run page

Open a run in the console and its verdicts render as a chip: the deterministic
`run-outcome@v1` (pass/fail plus the failure label) always, and the model
judge's score and explanation when one has been run. The same page lists the
[feedback](feedback-protocol.md) attached to the run — end-user thumbs joined by
the run's episode, or by one of its steps' inferences when there is no episode.
