# Probes guide — measure what models actually do

Model providers *declare* capabilities; the probe suite *measures* them.
Three probe classes, each producing dated, versioned JSON results with raw
per-sample records — so anyone can recompute the stats and rerun the suite
with their own key.

## The three capability classes

| Class | Question it answers | What a sample records |
|---|---|---|
| `schema` | Does the model produce output that **parses**, **conforms** to a JSON Schema, and gets the **values right**? | parse ok, schema conformance, value accuracy vs known-correct fixtures, serving rung (native strict vs json-mode coaching) |
| `grounding` | Does the model **actually search** when asked, or fabricate? | citation count (distinct URLs), grounded verdict |
| `caching` | Is declared prompt caching **realized**? | cached tokens reported on an identical repeat call |

The three schema levels are deliberately separate: plenty of models return
JSON that parses but violates the schema, or conforms to the schema with
wrong values. Routing on "supports JSON mode" alone is how silent quality
rot happens.

## What each measured column means

Each measured leaderboard column links to its method here. Every rate is a
sampled statistic with a 95% confidence interval — see [Honest
stochasticity](#honest-stochasticity) for what "reproducible" means.

### Schema conformance

The share of samples whose output both parsed as JSON and validated against the
requested JSON Schema. Parsing and conformance are scored separately: output
can parse and still violate the schema. Each sample records parse-ok, schema
conformance, and the serving rung (native strict enforcement vs json-mode
coaching).

### Value accuracy

Among conformant samples, the share whose field values matched the
known-correct answer in the fixture. Conformance checks the shape of the
output; value accuracy checks the numbers inside it — a model can pass one and
fail the other.

### Grounded

The share of grounding-class samples that carried at least one citation, counted
as distinct URLs. Measures whether the model actually searched when asked rather
than answering from memory.

### Cache hits

The share of identical repeat calls that reported cached input tokens. Measures
whether declared prompt caching is realized on the serving path.

## Running probes

```bash
npx modelrig-probes list-fixtures
npx modelrig-probes run --model openai/gpt-5.2 --class schema --samples 5
npx modelrig-probes run --model deepseek/deepseek-chat --class grounding
```

Results land in `results/<provider>-<model>/<class>-<date>.json` carrying the
harness version, a hash of every fixture exercised, all raw samples, and
per-fixture stats. Provider keys come from your environment
(`OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`).

**Budget guard:** every run carries an envelope (default $5/model,
`--envelope` to change). The run stops with a typed error the moment accrued
spend crosses it — partial results are kept and written.

## Honest stochasticity

Probes on live models are **sampled statistics, not deterministic tests**.
Results record sample counts, rates, and a Wilson 95% confidence interval —
never single-shot verdicts. "Reproducible" means: an independent rerun with
the same harness and fixtures lands **within the recorded interval**.

```bash
# integrity: recompute stats from the raw samples in a result file
npx modelrig-probes verify results/openai-gpt-5.2/schema-2026-08-01.json

# reproducibility: compare a fresh run against a published result
npx modelrig-probes run --model openai/gpt-5.2 --class schema --out /tmp/fresh
npx modelrig-probes verify /tmp/fresh/openai-gpt-5.2/schema-<date>.json \
  --against results/openai-gpt-5.2/schema-<date>.json
```

`verify` fails loudly if the stats block doesn't match the raw records
(tampering) or if fixture hashes differ (you're not running the same inputs).

## How results feed the registry

The registry's **probed layer** takes the latest result per model×class and
summarizes it next to the **declared layer** (vendor claims from the pricing
map + adapter capability maps). Where they disagree, the registry entry
carries a `discrepancies[]` array and the leaderboard flags it. Current
discrepancy detectors:

- `declared_schema_low_conformance` — claims schema support, probes below 90%
- `undeclared_schema_capable` — no claim, but probes conform ≥90%
- `schema_served_via_json_mode` — claims schema support, but every sample was
  served by prompt coaching (no native strict enforcement on this path)
- `declared_search_ungrounded` / `citations_without_declared_search`
- `declared_caching_unrealized` — claims prompt caching, zero cached tokens
  observed on repeat calls

## Coverage honesty

The v0 corpus is small and **finance-weighted** — it was seeded from our
first production customer, which bought realism at the cost of domain
breadth. Every fixture carries a `domain` tag (`finance`, `legal`,
`technical`, `e-commerce`, `general`, …), the leaderboard states the corpus
mix on every render, and per-fixture stats in each result file make
per-domain rates derivable. Treat aggregate rates as corpus-wide, never
domain-general.

## Contributing fixtures

**The headline ask is fixtures from your domain.** If a model's behavior on
*your* schema shape — or in your subject domain — isn't covered, add a
fixture: see the probe kit (`kits/probe-kit/`) in the public repo. Synthetic
data only; set the `domain` field; provenance is recorded in `source` and
credit lands on the leaderboard.
