/**
 * Observed-layer rollup shape (G-4, observed-health/spec §4.2). aggregateObserved
 * now enriches each endpoint with p90/p99 latency + TTFB, recent error-rate, and
 * a sample count — min-n gated so thin endpoints never surface a confident zero.
 * These tests pin what lands in layers/observed.json.
 */

import { describe, expect, it } from "vitest";
import { aggregateObserved } from "./build-observed";

const AS_OF = "2026-08-09T12:00:00.000Z";

interface Row {
  provider: string;
  model: string;
  served_tier: string;
  latency_ms: number;
  tokens_cached: number;
  failure_class: string | null;
  ttfb_ms?: number | null;
}

function rows(n: number, over: Partial<Row> = {}): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    provider: over.provider ?? "openai",
    model: over.model ?? "gpt-5.4-mini",
    served_tier: over.served_tier ?? "standard",
    latency_ms: over.latency_ms ?? (i + 1) * 100,
    tokens_cached: over.tokens_cached ?? 0,
    failure_class: over.failure_class ?? null,
    ttfb_ms: over.ttfb_ms === undefined ? (i + 1) * 10 : over.ttfb_ms,
  }));
}

describe("aggregateObserved — health enrichment", () => {
  it("writes p90/p99 latency + TTFB, error_rate and sample_n above min-n", () => {
    const data = [
      ...rows(8, { failure_class: null }),
      ...rows(2, { failure_class: "content_invalid", latency_ms: 900, ttfb_ms: 90 }),
    ];
    const out = aggregateObserved(data, AS_OF, 5)["openai/gpt-5.4-mini"];

    expect(out.sample_n).toBe(10);
    expect(out.inferences).toBe(10);
    expect(out.p90_latency_ms).not.toBeNull();
    expect(out.p99_latency_ms).not.toBeNull();
    expect(out.p90_ttfb_ms).not.toBeNull();
    expect(out.p99_ttfb_ms).not.toBeNull();
    expect(out.error_rate).toBeCloseTo(0.2); // 2 of 10 carry a failure_class
    // p50 stays populated (ungated, backward compatible).
    expect(out.p50_latency_ms).not.toBeNull();
  });

  it("gates health fields to null below min-n but still reports sample_n", () => {
    const out = aggregateObserved(rows(3), AS_OF, 20)["openai/gpt-5.4-mini"];
    expect(out.sample_n).toBe(3);
    expect(out.p90_latency_ms).toBeNull();
    expect(out.p99_latency_ms).toBeNull();
    expect(out.p90_ttfb_ms).toBeNull();
    expect(out.p99_ttfb_ms).toBeNull();
    expect(out.error_rate).toBeNull();
  });

  it("reports null TTFB percentiles when no TTFB samples exist (older rows)", () => {
    const out = aggregateObserved(rows(6, { ttfb_ms: null }), AS_OF, 5)["openai/gpt-5.4-mini"];
    expect(out.p90_latency_ms).not.toBeNull();
    expect(out.p90_ttfb_ms).toBeNull();
    expect(out.p99_ttfb_ms).toBeNull();
  });
});
