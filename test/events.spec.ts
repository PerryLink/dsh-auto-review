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
  autoReviewFailuresInOpenTurn,
  autoReviewsInOpenTurn,
  correlateApprovalId,
  effectiveAutoReviewState,
  findPresentedCall,
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
