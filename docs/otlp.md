# OTLP span export (gen_ai)

ModelRig can emit **one OpenTelemetry `gen_ai.*` span per inference** over
OTLP/HTTP to any collector you run — [Langfuse](https://langfuse.com),
Datadog, Grafana Tempo, the OpenTelemetry Collector, or anything that speaks
OTLP. Each row your rig already records (tokens, cost, latency, failure class)
becomes a span you can search and chart in the tools you already use.

It is **off by default** and additive: turning it on changes nothing about how
your rig routes, spends, or records — it only mirrors completed rows out to your
telemetry endpoint, fire-and-forget, on a background timer that never blocks or
fails a call.

## Turn it on

Set one environment variable:

```bash
# The OTLP/HTTP *traces* endpoint of your collector.
export MODELRIG_OTLP_ENDPOINT="https://cloud.langfuse.com/api/public/otel/v1/traces"

# Optional: auth headers your sink needs, as comma-separated k=v pairs.
export MODELRIG_OTLP_HEADERS="authorization=Basic <base64(public:secret)>"
```

With `MODELRIG_OTLP_ENDPOINT` **unset**, no emitter is ever constructed — zero
behaviour change. With it set, every rig this deployment runs starts emitting.

- **Endpoint** — the full traces URL. For Langfuse Cloud that is
  `https://<host>/api/public/otel/v1/traces`; for a local Collector it is
  typically `http://localhost:4318/v1/traces`.
- **Headers** — split on the **first** `=` per pair, so a base64 Basic-auth
  value keeps its `=` padding. Example:
  `authorization=Basic YWJjOmRlZg==,x-scope=prod`.

> **Credentials never leak.** The endpoint and headers can carry a token, so
> ModelRig never logs or displays them: `/status` shows only `otlp:
> configured|disabled`, and export failures are scrubbed before they reach a
> log line.

## What you get

Spans are emitted against **OpenTelemetry Semantic Conventions v1.41.0**
(`SEMCONV_VERSION`). Each inference becomes a `chat {model}` span (the synthetic
search-cost row becomes an `execute_tool search` span); a failed inference is a
span with status `ERROR` and a `modelrig.failure_class` attribute — failures are
facts and are emitted too.

### Attributes

| Attribute | Meaning |
|---|---|
| `gen_ai.operation.name` | `chat` (or `execute_tool` for the search row) |
| `gen_ai.provider.name` | the provider that served the attempt |
| `gen_ai.request.model` / `gen_ai.response.model` | the model |
| `gen_ai.usage.input_tokens` / `output_tokens` / `cached_input_tokens` | token counts |
| `modelrig.route` / `modelrig.route_version` | which route, which version |
| `modelrig.cost_estimate_usd` | estimated cost (0 with `modelrig.pricing_missing=true` when the model is unpriced — an honest zero, never an invented figure) |
| `modelrig.ttfb_ms` | time to first byte (omitted when unknown) |
| `modelrig.served_tier` / `served_variant` / `repaired_by` | serving provenance (nulls omitted) |
| `modelrig.failure_class` | failure class + span status `ERROR` (present only on failures) |
| `modelrig.fingerprint_cell` | schema-fingerprint cell (irreversible by construction) |

### Trace propagation

If a caller sends a W3C **`traceparent`** header to the HTTP gateway, ModelRig
parses it and nests the emitted span under the caller's trace (via
`traceId` + `parentSpanId`). Malformed headers are ignored — propagation is
best-effort and never fails a call. No schema change: the traceparent rides the
run's tags as `otel.traceparent`.

Span identity is **deterministic** — the trace/span ids derive from the
inference id — so a re-emit after a crash produces byte-identical spans and is
idempotent at your sink.

## What is **never** emitted

- **Prompt or completion content.** Telemetry rows hold no captured content, so
  there is structurally nothing to leak — the export-isolation test suite proves
  capture content never reaches the OTLP body, exactly as it proves it for the
  control-plane sink.
- **Tag *values*** other than `otel.traceparent` — only dimension *names* leave
  the row (the same doctrine the control-plane export follows).
- **Key-shaped strings** — the C2 leak gate covers this surface too.

## Scope (today)

Spans only (no metrics/logs signals); OTLP/HTTP **JSON** encoding (no protobuf);
export of **completed** rows (no mid-run streaming spans); no per-org hosted sink
config (one endpoint per deployment). These are deliberate v1 boundaries.
