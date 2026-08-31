/**
 * Projection-fold unit tests: the pure host mathematics behind the
 * `autoReview` panel value — budgets, statistics, circuit, never-rejection
 * counting, verdict rows, deny rows, caps, the wire-schema pass, and the
 * config-driven initial switch state.
 * @module dsh-auto-review/test/projection.spec
 */

import { describe, expect, it } from 'vitest'
import {
  AUTO_REVIEW_PROJECTION_SCHEMA,
  applyAutoReview,
  initAutoReviewProjection,
  makeAutoReviewProjection,
  viewAutoReview,
} from '../src/index.ts'

/** One raw-typed session event (the fold narrows by type discriminant). */
function rawEvent(type: string, data: unknown, time = 0): never {
  return { type, seq: 0, time, data } as never
}

/** One allow verdict payload for compact fixtures. */
function allow(reviewId: string, approvalId: string): unknown {
  return { reviewId, approvalId, toolName: 'bash', provider: 'fork', durationMs: 10, decision: 'allow', reason: 'ok', outcome: 'allowed-once' }
}

describe('autoReview projection fold', () => {
  it('folds state, verdicts, budgets, circuit, and deny rows', () => {
    let state = initAutoReviewProjection(true)
    state = applyAutoReview(state, rawEvent('autoReview/state', { enabled: false }))
    expect(state.enabled).toBe(false)
    state = applyAutoReview(state, rawEvent('turn/start', { turn: 1 }))
    state = applyAutoReview(state, rawEvent('autoReview/verdict', {
      reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork',
      durationMs: 10, decision: 'allow', reason: 'ok', outcome: 'allowed-once',
    }, 1))
    state = applyAutoReview(state, rawEvent('autoReview/verdict', {
      reviewId: 'r2', approvalId: 'a2', toolName: 'write', provider: 'fork',
      durationMs: 30, decision: 'deny', reason: 'no', outcome: 'rejected',
    }, 2))
    state = applyAutoReview(state, rawEvent('autoReview/verdict', {
      reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork',
      durationMs: 5, fallback: 'timeout', error: 'slow', outcome: 'rejected',
    }, 3))
    state = applyAutoReview(state, rawEvent('autoReview/circuit', {
      circuitId: 'c1', action: 'delegate', trip: { kind: 'consecutive', count: 3 }, toolName: 'write',
    }))
    state = applyAutoReview(state, rawEvent('autoReview/rejection', {
      rejectionId: 'n1', approvalId: 'a4', toolName: 'bash', reason: 'risk rule /x/ (reason)', outcome: 'rejected',
    }))
    const value = viewAutoReview(state)
    expect(value).toMatchObject({
      enabled: false,
      verdictsUsed: 2,
      failuresUsed: 1,
      allows: 1,
      denies: 1,
      fallbacks: 1,
      neverRejects: 1,
      avgDurationMs: 20,
    })
    expect(value.circuit).toMatchObject({ action: 'delegate', trip: { kind: 'consecutive', count: 3 } })
    expect(value.recent.map(row => row.reviewId)).toEqual(['r3', 'r2', 'r1'])
    expect(value.recentDenies.map(row => row.reviewId)).toEqual(['r2'])
    // The wire value must pass its own strict schema.
    expect(AUTO_REVIEW_PROJECTION_SCHEMA.safeParse(value).success).toBe(true)
  })

  it('returns the same reference for uninterested events', () => {
    const state = initAutoReviewProjection(true)
    expect(applyAutoReview(state, rawEvent('user/message', { content: [] }))).toBe(state)
    expect(applyAutoReview(state, rawEvent('autoReview/verdict', allow('r1', 'a1')))).not.toBe(state)
  })

  it('resets per-turn counters and the circuit at turn/start and closes at turn/end', () => {
    let state = initAutoReviewProjection(true)
    state = applyAutoReview(state, rawEvent('turn/start', { turn: 1 }))
    state = applyAutoReview(state, rawEvent('autoReview/verdict', allow('r1', 'a1')))
    state = applyAutoReview(state, rawEvent('turn/end', { turn: 1, reason: { kind: 'completed' } }))
    expect(state.turnOpen).toBe(false)
    state = applyAutoReview(state, rawEvent('turn/start', { turn: 2 }))
    const value = viewAutoReview(state)
    expect(value.verdictsUsed).toBe(0)
    expect(value.circuit).toBeNull()
  })

  it('caps the recent and deny rows', () => {
    let state = initAutoReviewProjection(true)
    for (let index = 0; index < 12; index += 1) {
      state = applyAutoReview(state, rawEvent('autoReview/verdict', {
        reviewId: `r${index}`, approvalId: `a${index}`, toolName: 'bash', provider: 'fork',
        durationMs: 1, decision: 'deny', reason: 'no',
      }))
    }
    const value = viewAutoReview(state)
    expect(value.recent).toHaveLength(8)
    expect(value.recentDenies).toHaveLength(5)
    expect(value.recentDenies[0]!.reviewId).toBe('r11')
  })

  it('counts risk-policy escalations as denials for the approve list', () => {
    let state = initAutoReviewProjection(true)
    state = applyAutoReview(state, rawEvent('autoReview/verdict', {
      reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork',
      durationMs: 1, decision: 'allow', reason: 'risky', riskLevel: 'high',
      escalation: 'risk-policy', outcome: 'rejected',
    }))
    expect(viewAutoReview(state).recentDenies.map(row => row.reviewId)).toEqual(['r1'])
  })

  it('counts cached verdicts separately while they still count as decisions', () => {
    let state = initAutoReviewProjection(true)
    state = applyAutoReview(state, rawEvent('autoReview/verdict', {
      reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork',
      durationMs: 0, decision: 'allow', reason: 'ok', outcome: 'allowed-once', cached: true,
    }))
    state = applyAutoReview(state, rawEvent('autoReview/verdict', allow('r2', 'a2')))
    const value = viewAutoReview(state)
    expect(value.cacheHits).toBe(1)
    expect(value.allows).toBe(2)
    expect(AUTO_REVIEW_PROJECTION_SCHEMA.safeParse(value).success).toBe(true)
  })

  it('starts at the mount-configured enableByDefault', () => {
    expect(viewAutoReview(initAutoReviewProjection(true)).enabled).toBe(true)
    expect(viewAutoReview(initAutoReviewProjection(false)).enabled).toBe(false)
    const enabled = makeAutoReviewProjection(true)
    const disabled = makeAutoReviewProjection(false)
    expect(enabled.key).toBe('autoReview')
    expect(disabled.key).toBe('autoReview')
    const header = { version: 0, id: 'test-session', createdAt: 0 } as never
    expect(viewAutoReview(enabled.init(header)).enabled).toBe(true)
    expect(viewAutoReview(disabled.init(header)).enabled).toBe(false)
  })

  it('bumps stateVersion with the enabled-default change', () => {
    expect(makeAutoReviewProjection(true).stateVersion).toBeGreaterThanOrEqual(3)
    // The wire schema still validates both init variants.
    expect(AUTO_REVIEW_PROJECTION_SCHEMA.safeParse(viewAutoReview(initAutoReviewProjection(false))).success).toBe(true)
  })
})
