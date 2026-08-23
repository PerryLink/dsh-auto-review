/**
 * Stress-metric computation for dsh-eval: pure functions over per-step
 * timing records collected by the trace fold. The `expect.stress` assertion
 * gates P99 step latency, time-to-first-token, and token generation speed —
 * the LLM-Stress-Test-CLI metrics — without any hardcoded thresholds (the
 * case declares its own).
 * @module dsh-auto-review/eval/stress
 */

import type { TraceStep } from './trace.ts'

/** Percentile metrics and throughput of one case run. */
export interface StressMetrics {
  /** How many steps carried any timing. */
  readonly stepCount: number
  /** 50th-percentile step latency (ms). */
  readonly p50Ms?: number
  /** 90th-percentile step latency (ms). */
  readonly p90Ms?: number
  /** 95th-percentile step latency (ms). */
  readonly p95Ms?: number
  /** 99th-percentile step latency (ms). */
  readonly p99Ms?: number
  /** Median time-to-first-token (ms). */
  readonly ttftMedianMs?: number
  /** Worst time-to-first-token (ms). */
  readonly ttftMaxMs?: number
  /** Aggregate token generation speed (output tokens per second). */
  readonly tokensPerSecond?: number
}

/**
 * Nearest-rank percentile of a sorted ascending sample.
 * @param sorted - ascending sample.
 * @param p - percentile in (0, 100].
 * @returns the sample value at the requested percentile, or undefined for an
 *   empty sample.
 */
export function percentile(sorted: readonly number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  const index = Math.max(0, Math.min(sorted.length - 1, rank))
  return sorted[index]
}

/**
 * Compute stress metrics from the collected per-step timing records. Steps
 * without a start/end, start/first-token, or first/last-token window simply
 * do not contribute to the metric they cannot measure.
 * @param steps - the trace's per-step timing records.
 * @returns the owned metrics.
 */
export function computeStressMetrics(steps: readonly TraceStep[]): StressMetrics {
  const latencies: number[] = []
  const ttfts: number[] = []
  let totalOutput = 0
  let totalGenMs = 0
  for (const step of steps) {
    if (step.startMs !== undefined && step.endMs !== undefined && step.endMs >= step.startMs) {
      latencies.push(step.endMs - step.startMs)
    }
    if (step.startMs !== undefined && step.firstTokenMs !== undefined && step.firstTokenMs >= step.startMs) {
      ttfts.push(step.firstTokenMs - step.startMs)
    }
    if (step.outputTokens !== undefined) totalOutput += step.outputTokens
    if (step.firstTokenMs !== undefined && step.lastTokenMs !== undefined && step.lastTokenMs > step.firstTokenMs) {
      totalGenMs += step.lastTokenMs - step.firstTokenMs
    }
  }
  latencies.sort((a, b) => a - b)
  ttfts.sort((a, b) => a - b)
  const p50 = latencies.length > 0 ? percentile(latencies, 50) : undefined
  const p90 = latencies.length > 0 ? percentile(latencies, 90) : undefined
  const p95 = latencies.length > 0 ? percentile(latencies, 95) : undefined
  const p99 = latencies.length > 0 ? percentile(latencies, 99) : undefined
  const ttftMedian = ttfts.length > 0 ? percentile(ttfts, 50) : undefined
  const ttftMax = ttfts.length > 0 ? ttfts[ttfts.length - 1] : undefined
  const tokensPerSecond = totalGenMs > 0 ? totalOutput / (totalGenMs / 1000) : undefined
  return {
    stepCount: steps.length,
    ...(p50 !== undefined ? { p50Ms: p50 } : {}),
    ...(p90 !== undefined ? { p90Ms: p90 } : {}),
    ...(p95 !== undefined ? { p95Ms: p95 } : {}),
    ...(p99 !== undefined ? { p99Ms: p99 } : {}),
    ...(ttftMedian !== undefined ? { ttftMedianMs: ttftMedian } : {}),
    ...(ttftMax !== undefined ? { ttftMaxMs: ttftMax } : {}),
    ...(tokensPerSecond !== undefined ? { tokensPerSecond } : {}),
  }
}
