/**
 * Stress-metric tests: percentile ranking and P99/TTFT/token-speed folding.
 * @module dsh-auto-review/test/eval/stress
 */

import { describe, expect, it } from 'vitest'
import { computeStressMetrics, percentile } from '../../src/eval/stress.ts'
import type { TraceStep } from '../../src/eval/trace.ts'

describe('percentile', () => {
  it('uses nearest-rank percentile', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([1, 2, 3, 4], 99)).toBe(4)
    expect(percentile([1, 2, 3, 4], 25)).toBe(1)
    expect(percentile([], 99)).toBeUndefined()
  })
})

describe('computeStressMetrics', () => {
  it('folds step latency, TTFT, and token speed from timing records', () => {
    const steps: TraceStep[] = [
      { turn: 1, step: 1, startMs: 1000, firstTokenMs: 1050, lastTokenMs: 2050, endMs: 2100, outputTokens: 200 },
      { turn: 1, step: 2, startMs: 2200, firstTokenMs: 2240, lastTokenMs: 3240, endMs: 3300, outputTokens: 100 },
    ]
    const metrics = computeStressMetrics(steps)
    expect(metrics.stepCount).toBe(2)
    expect(metrics.p50Ms).toBe(1100)
    expect(metrics.p99Ms).toBe(1100)
    // Nearest-rank P50 of [40, 50] is the first sample (index 0).
    expect(metrics.ttftMedianMs).toBe(40)
    expect(metrics.ttftMaxMs).toBe(50)
    // (200 + 100) tokens over (1000 + 1000) ms = 150 tokens/second.
    expect(metrics.tokensPerSecond).toBe(150)
  })

  it('ignores steps without a usable timing window', () => {
    const metrics = computeStressMetrics([{ turn: 1, step: 1 }])
    expect(metrics.stepCount).toBe(1)
    expect(metrics.p99Ms).toBeUndefined()
    expect(metrics.ttftMaxMs).toBeUndefined()
    expect(metrics.tokensPerSecond).toBeUndefined()
  })

  it('computes P99 over many latencies', () => {
    const steps: TraceStep[] = Array.from({ length: 100 }, (_, index) => ({
      turn: 1,
      step: index + 1,
      startMs: 0,
      endMs: index + 1,
    }))
    expect(computeStressMetrics(steps).p99Ms).toBe(99)
  })
})
