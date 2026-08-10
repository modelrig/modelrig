# Request a probe

**What this is:** the way to get a model into the ModelRig registry. If a model
you rely on isn't in our data, that's a gap we want to know about — the honest
answer to "can this model do X?" is currently *"we haven't measured it"*, and
that answer should be temporary.

**Why we don't just add it:** every entry in the registry is *measured*, not
copied from a provider's page. Adding a model means running the probe suite
against it — real calls, real money, real sampling — so requests are queued
against a budget rather than merged on sight.

---

## The template

This is the canonical text for the public repo's
`.github/ISSUE_TEMPLATE/probe-request.yml`. Keep the two in sync; edit here.

```yaml
name: Probe request
description: Ask for a model to be measured and added to the registry
title: "probe: <provider>/<model>"
labels: ["probe-request"]
body:
  - type: markdown
    attributes:
      value: |
        Every registry entry is measured, not declared. Filing this queues a
        probe run against our monthly budget — the more specific you are about
        WHY you need it, the sooner it gets picked up.

  - type: input
    id: model_key
    attributes:
      label: Model key
      description: 'Exactly as the provider names it, prefixed by host: "deepinfra/Qwen/Qwen3-235B-A22B"'
      placeholder: provider/model
    validations:
      required: true

  - type: dropdown
    id: classes
    attributes:
      label: What should we measure?
      multiple: true
      options:
        - schema conformance (does it hold a JSON Schema?)
        - grounding (does it cite real sources?)
        - caching (do repeat calls actually hit cache?)
    validations:
      required: true

  - type: textarea
    id: use_case
    attributes:
      label: What are you trying to decide?
      description: |
        The decision this data would inform — "considering it as a cheaper
        candidate for a schema-heavy extraction route" is far more useful than
        "it looks good". This is what gets a request prioritized.
    validations:
      required: true

  - type: input
    id: incumbent
    attributes:
      label: What are you using today?
      description: The model this one would replace, if any. Comparisons get priority.

  - type: checkboxes
    id: access
    attributes:
      label: Access
      options:
        - label: This model is available on a host we already probe (OpenAI, Anthropic, Google, DeepSeek, xAI, DeepInfra, Fireworks)
        - label: I can help cover the probe cost or provide credits

  - type: markdown
    attributes:
      value: |
        **What happens next:** requests are triaged against
        [parity-50](https://github.com/modelrig/modelrig/blob/main/registry/parity-50.json)
        — our coverage target against the 50 most-used models. A request for a
        model already on that list moves fastest. Everything measured lands in
        `registry/registry.json` with its `as_of` stamp and sample count, and
        the answer becomes available to everyone, including through the MCP
        oracle's `query_registry` tool.
```

---

## What we do with unmatched questions

The MCP oracle logs the *shape* of every question it can't answer — which
capability, which model, whether we matched — with no payloads and no account
linkage. Those unmatched rows are a demand meter: they tell us which models
people are asking about before anyone files an issue. A probe request is the
same signal, said out loud, with a use case attached — which is why it carries
more weight.

## Coverage honesty

We publish what we've measured and we publish what we haven't. `parity-50.json`
tracks how much of the industry's most-used models we actually cover; that
number moves when campaigns run, and it's refreshed monthly against a list that
changes underneath it. If we're at 7 of 28 probed, the leaderboard says 7 of 28.
