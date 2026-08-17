# Recognition playbooks — per provider and framework

How the ModelRig skill recognizes a model call site, and what the **before →
after** looks like when it extracts a route (Tier 2). One section per provider /
framework: **OpenAI**, **Anthropic**, **Vercel AI SDK**, **LangChain**, and **raw
`fetch`**. The examples are canonical illustrations written for this page — not
code lifted from any repo.

Two things are true of every after-example, because they are ladder rules:

- **Same-model.** The drafted route pins the *exact* provider/model the original
  used. Tier 2 changes the plumbing, never the model — a model change is Tier 3
  and never the skill's (see the [playbook](https://modelrig.dev/migration-playbook.html)).
- **The original call is deleted, not commented out**, with a one-line
  breadcrumb; rollback is `git revert` of the one-call-site PR.

> **"Recognized by `modelrig init`" vs. "recognized by the skill."** `modelrig
> init` greps for provider **SDK call shapes** and API hosts — it auto-drafts
> OpenAI / Anthropic / Gemini SDK calls and raw `fetch` to a known host.
> Framework wrappers (the Vercel AI SDK's `generateText`, LangChain's `.invoke`)
> hide the SDK, so `init` may not auto-draft them — the **skill** recognizes them
> by judgment and drafts the route by hand. That judgment gap is the whole reason
> the skill exists on top of `init`.

---

## OpenAI (`openai`)

**Recognized by** `modelrig init`: an `openai` import plus a `.chat.completions.create(`,
`.responses.create(`, or `.completions.create(` call. Structured output is read
from `response_format` / `text` / `json_schema`.

**Before** — a direct call with an inline system prompt and JSON-schema output:

```ts
import OpenAI from "openai";
const client = new OpenAI();

const res = await client.chat.completions.create({
  model: "gpt-5.4-mini",
  response_format: { type: "json_schema", json_schema: { name: "summary", schema: SummarySchema } },
  messages: [
    { role: "system", content: "Summarize the filing in two sentences. Return JSON." },
    { role: "user", content: filingText },
  ],
});
const summary = JSON.parse(res.choices[0].message.content);
```

**After** — the prompt becomes a `systemTemplate` + a `{{filingText}}` variable,
the schema moves into the bundle, the call becomes `rig.run` (same model pinned):

```yaml
# modelrig/routes/pipeline.summarize.yaml
route: pipeline.summarize
version: 1
schema: schemas/pipeline.summarize.schema.json
candidates:
  - provider: openai
    model: gpt-5.4-mini          # same model the original used — pinned
require:
  - schema_conformant
prefer: []
prompt:
  system: prompts/pipeline.summarize.system.md   # "Summarize the filing… Return JSON."
  variables: [filingText]
policy:
  retries: { schema: 1, transient: 2 }
  timeout_ms: 120000
  tier: standard
  json: native                   # only because gpt-5.4-mini probes structured_native
```

```ts
// modelrig: migrated from client.chat.completions.create(...) — rollback: revert PR #N
const { output: summary } = await rig.run("pipeline.summarize", {
  input: { filingText },
  tags: { run_id: runId },
});
```

Verify before proposing the merge: `modelrig verify-swap --route pipeline.summarize
--captures fixture.json --out pr-report.md`, then paste `pr-report.md` into the PR.

---

## Anthropic (`@anthropic-ai/sdk`)

**Recognized by** `modelrig init`: an `@anthropic-ai/sdk` import plus
`.messages.create(`. The system turn is the top-level `system` string.
`.messages.stream(` is **also recognized — and flagged as streaming** (a stated
limit: routed per the batch-first deferral, not silently converted).

**Before**:

```ts
import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic();

const msg = await anthropic.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 1024,
  system: "Classify the filing into one of: 10-K, 10-Q, 8-K. Answer with the code only.",
  messages: [{ role: "user", content: filingText }],
});
const code = msg.content[0].text.trim();
```

**After** — no output schema (freeform short answer), so `schema: null` and the
route just enforces the model + prompt. Note `max_tokens` carried into policy:

```yaml
# modelrig/routes/pipeline.classify.yaml
route: pipeline.classify
version: 1
candidates:
  - provider: anthropic
    model: claude-sonnet-5        # pinned — same model
require: []
prefer: []
prompt:
  system: prompts/pipeline.classify.system.md
  variables: [filingText]
policy:
  retries: { transient: 2 }
  timeout_ms: 120000
  tier: standard
```

```ts
// modelrig: migrated from anthropic.messages.create(...) — rollback: revert PR #N
const { output: code } = await rig.run("pipeline.classify", { input: { filingText }, tags: { run_id: runId } });
```

If the call site were `anthropic.messages.stream(...)`, the skill would **not**
convert it — it would flag it as streaming and leave it for the batch-first
deferral, or point the gateway at it (Tier 0) so it is observed without a rewrite.

---

## Vercel AI SDK (`ai` + `@ai-sdk/*`)

**Recognized by the skill** (judgment): the `ai` package's `generateText` /
`generateObject`, with a provider model from `@ai-sdk/openai` (or `-anthropic`,
`-google`). `modelrig init` sees the `@ai-sdk/*` import but greps for the raw SDK
call shape, so it may not auto-draft these — the skill drafts them.
`generateObject` with a Zod schema is the cleanest possible Tier 2: the schema is
already declared.

**Before**:

```ts
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const { object } = await generateObject({
  model: openai("gpt-5.4-mini"),
  schema: z.object({ sentiment: z.enum(["pos", "neg", "neu"]), confidence: z.number() }),
  system: "Score the sentiment of the earnings call excerpt.",
  prompt: excerpt,
});
```

**After** — the Zod schema is emitted to the bundle's JSON Schema; the model id
inside `openai("…")` is the pin:

```yaml
# modelrig/routes/pipeline.sentiment.yaml
route: pipeline.sentiment
version: 1
schema: schemas/pipeline.sentiment.schema.json   # from the Zod schema
candidates:
  - provider: openai
    model: gpt-5.4-mini          # pinned — same model the ai-sdk call used
require:
  - schema_conformant
prefer: []
prompt:
  system: prompts/pipeline.sentiment.system.md
  variables: [excerpt]
policy:
  retries: { schema: 1, transient: 2 }
  timeout_ms: 120000
  tier: standard
  json: native
```

```ts
// modelrig: migrated from generateObject({ model: openai("gpt-5.4-mini"), … }) — rollback: revert PR #N
const { output } = await rig.run("pipeline.sentiment", { input: { excerpt }, tags: { run_id: runId } });
```

`streamText` / `streamObject` are the streaming forms — recognized and flagged,
not converted.

---

## LangChain (`@langchain/*`)

**Recognized by the skill** (judgment): a `@langchain/openai` (or `-anthropic`)
chat model — `new ChatOpenAI({ model })` — invoked via `.invoke(...)`, often
behind a `ChatPromptTemplate` and `.withStructuredOutput(...)`. `modelrig init`
does not detect LangChain (the SDK call is wrapped), so the skill recognizes and
drafts it. LangChain's own prompt template maps almost one-to-one to a route's
`systemTemplate` + variables.

**Before**:

```ts
import { ChatOpenAI } from "@langchain/openai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";

const model = new ChatOpenAI({ model: "gpt-5.4-mini" }).withStructuredOutput(
  z.object({ tickers: z.array(z.string()) }),
);
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "Extract every stock ticker mentioned. Return JSON."],
  ["human", "{document}"],
]);
const { tickers } = await prompt.pipe(model).invoke({ document });
```

**After** — LangChain's `{document}` template variable is already the route's
variable (declared as `{{document}}` in the system template); the structured
output schema moves into the bundle:

```yaml
# modelrig/routes/pipeline.extract_tickers.yaml
route: pipeline.extract_tickers
version: 1
schema: schemas/pipeline.extract_tickers.schema.json
candidates:
  - provider: openai
    model: gpt-5.4-mini          # pinned — same model as the ChatOpenAI instance
require:
  - schema_conformant
prefer: []
prompt:
  system: prompts/pipeline.extract_tickers.system.md
  variables: [document]
policy:
  retries: { schema: 1, transient: 2 }
  timeout_ms: 120000
  tier: standard
  json: native
```

```ts
// modelrig: migrated from prompt.pipe(model).invoke({ document }) — rollback: revert PR #N
const { output } = await rig.run("pipeline.extract_tickers", { input: { document }, tags: { run_id: runId } });
```

A multi-step LangChain **chain or agent loop** is *not* one task-shaped bundle —
the skill flags it (freeform agentic loop → the raw lane is the correct outcome),
and may instead point the gateway at the underlying model (Tier 0) so the loop is
observed without being reshaped.

---

## Raw `fetch` (provider host)

**Recognized by** `modelrig init`: a `fetch` / `axios` / `post` whose URL is a
known provider host (`api.openai.com`, `api.anthropic.com`,
`generativelanguage.googleapis.com`, and the OpenAI-compatible hosts
`api.deepseek.com`, `api.x.ai`, `api.deepinfra.com`, `api.fireworks.ai`) with a
JSON `body`. The finder reads the request body — including through a
`JSON.stringify(...)` wrapper — for the `model` and system message.

**Before**:

```ts
const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({
    model: "gpt-5.4-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return a JSON object with a `risks` array." },
      { role: "user", content: sectionText },
    ],
  }),
});
const { risks } = JSON.parse((await res.json()).choices[0].message.content);
```

**After** — the drafted route is identical in shape to the SDK case (the host
told the finder the provider). `response_format: { type: "json_object" }` is a
coached-JSON request, not native strict — so the bundle **omits `json: native`**
unless the model's registry entry proves `structured_native`:

```yaml
# modelrig/routes/pipeline.risks.yaml
route: pipeline.risks
version: 1
schema: schemas/pipeline.risks.schema.json
candidates:
  - provider: openai
    model: gpt-5.4-mini          # pinned — same model from the request body
require:
  - schema_conformant
prefer: []
prompt:
  system: prompts/pipeline.risks.system.md
  variables: [sectionText]
policy:
  retries: { schema: 1, transient: 2 }
  timeout_ms: 120000
  tier: standard
  # json: native omitted — the original asked for json_object (coached), not a
  # native strict schema. Set it only if the registry shows structured_native.
```

```ts
// modelrig: migrated from fetch("https://api.openai.com/v1/chat/completions", …) — rollback: revert PR #N
const { output } = await rig.run("pipeline.risks", { input: { sectionText }, tags: { run_id: runId } });
```

---

Back to the [migration playbook](https://modelrig.dev/migration-playbook.html)
for the full ladder, the verify step, and the stated limits.
