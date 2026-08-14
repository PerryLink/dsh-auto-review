/**
 * Audit-fold unit tests: state override folds, per-turn verdict counting,
 * approval/asked correlation, and presented-call lookup — the pure functions
 * the runtime and the invariant companion build on.
 * @module dsh-auto-review/test/events.spec
 */

import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import {
  activeOverride,
  autoReviewFailuresInOpenTurn,
  autoReviewsInOpenTurn,
  circuitInOpenTurn,
  consecutiveDeniesInOpenTurn,
  correlateApprovalId,
  deniesInRecentVerdicts,
  effectiveAutoReviewState,
  findPresentedCall,
  lastDeniedVerdicts,
  openTurnVerdicts,
  reviewStats,
} from '../src/index.ts'

function sessionWith(...events: { type: string; data: unknown }[]): Session {
  const session = Session.create(SessionId(`fold-${events.length}`))
  const append = session.append as unknown as (type: string, data: unknown) => unknown
  for (const event of events) {
    append.call(session, event.type, event.data)
  }
  return session
}

describe('effectiveAutoReviewState', () => {
  it('folds the last state event and returns undefined without one', () => {
    expect(effectiveAutoReviewState(sessionWith().events)).toBeUndefined()
    const session = sessionWith(
      { type: 'autoReview/state', data: { enabled: false } },
      { type: 'autoReview/state', data: { enabled: true } },
    )
    expect(effectiveAutoReviewState(session.events)).toBe(true)
  })
})

describe('autoReviewsInOpenTurn', () => {
  it('counts decision verdicts only inside the current open turn', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'rf', approvalId: 'af', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'timeout' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
    )
    expect(autoReviewsInOpenTurn(session.events)).toBe(1)
  })

  it('counts zero outside any turn or for fallback-only turns', () => {
    expect(autoReviewsInOpenTurn(sessionWith(
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'timeout' } },
    ).events)).toBe(0)
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'rf', approvalId: 'af', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'unavailable' } },
      { type: 'autoReview/verdict', data: { reviewId: 'rc', approvalId: 'ac', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'cancelled' } },
    )
    expect(autoReviewsInOpenTurn(session.events)).toBe(0)
  })
})

describe('autoReviewFailuresInOpenTurn', () => {
  it('counts reviewer failures but not user cancellations or decisions', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'timeout' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'schema' } },
      { type: 'autoReview/verdict', data: { reviewId: 'rc', approvalId: 'ac', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'cancelled' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
    )
    expect(autoReviewFailuresInOpenTurn(session.events)).toBe(2)
  })
})

describe('correlateApprovalId', () => {
  it('finds the last unpaired asked event matching the call id', () => {
    const session = sessionWith(
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash', callId: 'call-1' } },
      { type: 'approval/asked', data: { id: 'a2', toolName: 'write', callId: 'call-2' } },
      { type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } },
    )
    expect(correlateApprovalId(session.events, 'bash', CallId('call-1'))).toBeUndefined()
    expect(correlateApprovalId(session.events, 'write', CallId('call-2'))).toBe('a2')
  })

  it('falls back to tool name when the request has no call id', () => {
    const session = sessionWith(
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
    )
    expect(correlateApprovalId(session.events, 'bash')).toBe('a1')
  })

  it('skips paired asked events and returns undefined for an unknown request', () => {
    const session = sessionWith(
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
      { type: 'approval/decided', data: { id: 'a1', outcome: 'rejected' } },
    )
    expect(correlateApprovalId(session.events, 'bash')).toBeUndefined()
  })
})

describe('findPresentedCall', () => {
  it('returns the last tool/call arguments for the call id', () => {
    const session = sessionWith(
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"ls"}' } },
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-2', name: 'bash', arguments: '{"command":"rm"}' } },
    )
    expect(findPresentedCall(session.events, CallId('call-2'))).toBe('{"command":"rm"}')
    expect(findPresentedCall(session.events, CallId('call-9'))).toBeUndefined()
  })
})

describe('circuit-breaker folds', () => {
  it('counts the trailing run of denials including risk-policy escalations', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok', escalation: 'risk-policy', outcome: 'rejected' } },
    )
    expect(consecutiveDeniesInOpenTurn(session.events)).toBe(2)
  })

  it('breaks the streak on an allow verdict', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
    )
    expect(consecutiveDeniesInOpenTurn(session.events)).toBe(1)
  })

  it('counts denials inside the recent-verdict window only', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
    )
    expect(deniesInRecentVerdicts(session.events, 2)).toBe(1)
    expect(deniesInRecentVerdicts(session.events, 3)).toBe(2)
  })

  it('finds the open turn circuit trip and none otherwise', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/circuit', data: { circuitId: 'c1', action: 'delegate', trip: { kind: 'consecutive', count: 3 }, toolName: 'bash' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', data: { turn: 2 } },
    )
    expect(circuitInOpenTurn(session.events)).toBeUndefined()
    const open = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/circuit', data: { circuitId: 'c2', action: 'reject', trip: { kind: 'window', count: 10 }, toolName: 'write' } },
    )
    expect(circuitInOpenTurn(open.events)?.circuitId).toBe('c2')
  })
})

describe('override folds', () => {
  it('lists recent denials newest first', () => {
    const session = sessionWith(
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'first' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'write', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'second' } },
    )
    expect(lastDeniedVerdicts(session.events, 5).map(d => d.reviewId)).toEqual(['r3', 'r1'])
  })

  it('keeps an override active until the next same-tool verdict or its TTL', () => {
    const session = sessionWith(
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/override', data: { reviewId: 'r1', toolName: 'bash' } },
    )
    const overrideEvent = session.events.find(event => event.type === 'autoReview/override')!
    expect(activeOverride(session.events, 'bash', 60_000, overrideEvent.time + 1)).toBe('r1')
    expect(activeOverride(session.events, 'bash', 60_000, overrideEvent.time + 60_001)).toBeUndefined()
    expect(activeOverride(session.events, 'write', 60_000, overrideEvent.time + 1)).toBeUndefined()
  })

  it('is consumed by the next same-tool verdict', () => {
    const session = sessionWith(
      { type: 'autoReview/override', data: { reviewId: 'r1', toolName: 'bash' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
    )
    const verdictEvent = session.events.find(event => event.type === 'autoReview/verdict')!
    expect(activeOverride(session.events, 'bash', 60_000, verdictEvent.time + 1)).toBeUndefined()
  })
})

describe('review statistics', () => {
  it('folds counts, mean duration, and the recent verdicts', () => {
    const session = sessionWith(
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 10, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'write', provider: 'fork', durationMs: 30, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 5, fallback: 'timeout' } },
    )
    expect(reviewStats(session.events)).toMatchObject({
      allows: 1,
      denies: 1,
      fallbacks: 1,
      avgDurationMs: 20,
    })
    expect(reviewStats(session.events).recent.map(verdict => verdict.reviewId)).toEqual(['r3', 'r2', 'r1'])
  })
})

describe('openTurnVerdicts', () => {
  it('returns only the current open turn verdicts, oldest first', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
    )
    expect(openTurnVerdicts(session.events).map(verdict => verdict.reviewId)).toEqual(['r2'])
  })
})
