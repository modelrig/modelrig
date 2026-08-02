# Probe kit

**The headline ask: fixtures from your domain.** The v0 corpus is
finance-weighted because it was seeded from our first production customer —
a model that conforms on financial extractions may behave differently on
legal clauses, product catalogs, or medical intake forms. Contributing a
fixture from your domain gets your case covered forever, with your credit on
the leaderboard, and makes every aggregate rate more honest.

## Fixture format

Copy `fixture-template.json`. Fields:

- `id` — unique kebab-case identifier.
- `class` — `schema` | `grounding` | `caching`.
- `domain` — the task's subject domain, lowercase token: `finance`, `legal`,
  `technical`, `e-commerce`, `general`, or your own. Domain is metadata (it
  never reaches the model and is excluded from the fixture hash); it labels
  coverage so results are never presented as domain-general.
- `prompt` — the full task prompt. For schema fixtures, include the source
  data inline (synthetic data only — never real customer content).
- `schema` — (schema class) the JSON Schema the output must conform to.
- `expectedValues` — (optional) dot-paths to known-correct extractable values;
  this is what separates *conforms* from *values-correct*.
- `source` — `contributed:<your-github-handle>`.

## Ground rules

- Synthetic data only. No real names, tickers you care about, client
  information, or anything you'd mind seeing on a public leaderboard forever.
- Fixtures should complete in one call at modest token counts — the suite
  runs N samples per fixture under a budget envelope.
- Include at least one run's result file in your PR (`npx modelrig-probes run
  --model <any-model> --class <class>`).

This kit is a skeleton in Phase 2 — the dispute flow (`modelrig-probes
dispute`) and named leaderboard credits automate in a later phase.
