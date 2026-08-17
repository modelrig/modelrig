# Bring your traces: OTLP ingest

You already instrument your AI app with OpenTelemetry — the Vercel AI SDK, LangChain/LangGraph,
OpenLLMetry, Pydantic AI, Claude Code, or your own spans. Point that same trace stream at ModelRig
and each trace becomes a **run** you can open in the console, with one **attested step** per span:
its model, provider, operation, timing, status, and token usage, rendered next to your gateway-measured
runs.

## What we read

For every span, we normalize **structure and identity only**:

- **identity** — trace id → run, span id → step, parent span id
- **timing** — start/end, and the wall-clock duration
- **status** — an error span becomes a failed step
- **model & provider** — resolved across OTel vintages (`gen_ai.response.model`, `ai.model.id`,
  `llm.model_name`, …); the provider is resolved honestly and recorded as `unknown` when your
  spans don't say — never guessed
- **usage** — input/output tokens across the `gen_ai.usage.*` and `llm.token_count.*` conventions,
  with cached and reasoning tokens de-double-counted so the net is billable-accurate

## What we never read

**No content, ever.** Prompts, completions, chat messages, tool arguments, tool results, retrieved
documents — the *content* of your spans is never read, never stored, never logged. The normalizer
only looks at the structural attributes above; a content attribute like `ai.prompt.messages` is
counted (so the numbers stay honest) and then dropped. This is the retention-free default: content
custody is a separate, explicitly opted-in feature.

## Sending traces

`POST https://<your-modelrig-host>/v1/otlp/v1/traces`

- **Auth:** a `rig_sk_` key with the `ingest` scope, in the `Authorization` header — the same key
  your exporter already uses. Create one in the console under **Keys**.
- **Body:** an OTLP `ExportTraceServiceRequest`. Both `application/x-protobuf` and
  `application/json` are accepted, with optional `gzip`.
- **Tenancy:** every run and step is filed under the key's organization. Your spans cannot name a
  different one.

Most OTLP exporters just need the endpoint URL and the `Authorization` header. For example, with the
OpenTelemetry SDK set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the path above and add your key to
`OTEL_EXPORTER_OTLP_TRACES_HEADERS`.

## Limits and gotchas

- **Size caps are hard.** Oversized batches are rejected so the next export resends — telemetry is
  never silently truncated.
- **Traces only.** This is the OTLP *traces* endpoint. A **logs** exporter pointed here is rejected
  with a message that explains the mix-up (logs and traces share protobuf field numbers, so a logs
  batch decodes here as spans with no ids).
- **Attested vs ground-truth.** Steps ingested this way carry an **attested** badge: they were
  emitted by your own instrumentation, not measured as they passed through the ModelRig gateway.
  Runs that *do* route through the gateway carry **ground-truth** steps with measured cost. Both
  live in the same run view, clearly labelled.

## What you get

Open **Runs** in the console. An OTLP-ingested trace appears as a run whose steps carry the attested
badge, their model and provider, and their token usage — the same drill-down as your measured runs,
for any framework you already emit from.
