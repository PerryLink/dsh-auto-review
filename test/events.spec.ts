/**
 * Audit-fold unit tests: state override folds, per-turn verdict counting,
 * approval/asked correlation, and presented-call lookup — the pure functions
 * the runtime and the invariant companion build on.
 * @module dsh-auto-review/test/events.spec
 */

import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from './call-id.ts'
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
  resolvePresentedCall,
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
    expect(effectiveAutoReviewState(sessionWith().snapshotEvents())).toBeUndefined()
    const session = sessionWith(
      { type: 'autoReview/state', data: { enabled: false } },
      { type: 'autoReview/state', data: { enabled: true } },
    )
    expect(effectiveAutoReviewState(session.snapshotEvents())).toBe(true)
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
    expect(autoReviewsInOpenTurn(session.snapshotEvents())).toBe(1)
  })

  it('counts zero outside any turn or for fallback-only turns', () => {
    expect(autoReviewsInOpenTurn(sessionWith(
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'timeout' } },
    ).snapshotEvents())).toBe(0)
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'rf', approvalId: 'af', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'unavailable' } },
      { type: 'autoReview/verdict', data: { reviewId: 'rc', approvalId: 'ac', toolName: 'bash', provider: 'fork', durationMs: 1, fallback: 'cancelled' } },
    )
    expect(autoReviewsInOpenTurn(session.snapshotEvents())).toBe(0)
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
    expect(autoReviewFailuresInOpenTurn(session.snapshotEvents())).toBe(2)
  })
})

describe('correlateApprovalId', () => {
  it('finds the last unpaired asked event matching the call id', () => {
    const session = sessionWith(
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash', callId: 'call-1' } },
      { type: 'approval/asked', data: { id: 'a2', toolName: 'write', callId: 'call-2' } },
      { type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } },
    )
    expect(correlateApprovalId(session.snapshotEvents(), 'bash', CallId('call-1'))).toBeUndefined()
    expect(correlateApprovalId(session.snapshotEvents(), 'write', CallId('call-2'))).toBe('a2')
  })

  it('falls back to tool name when the request has no call id', () => {
    const session = sessionWith(
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
    )
    expect(correlateApprovalId(session.snapshotEvents(), 'bash')).toBe('a1')
  })

  it('skips paired asked events and returns undefined for an unknown request', () => {
    const session = sessionWith(
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
      { type: 'approval/decided', data: { id: 'a1', outcome: 'rejected' } },
    )
    expect(correlateApprovalId(session.snapshotEvents(), 'bash')).toBeUndefined()
  })
})

describe('findPresentedCall', () => {
  it('returns the last tool/call arguments for the call id', () => {
    const session = sessionWith(
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"ls"}' } },
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'call-2', name: 'bash', arguments: '{"command":"rm"}' } },
    )
    expect(findPresentedCall(session.snapshotEvents(), CallId('call-2'))).toBe('{"command":"rm"}')
    expect(findPresentedCall(session.snapshotEvents(), CallId('call-9'))).toBeUndefined()
  })

  // Regression for #83: a PTC approval carries `<outer>:ptc:<n>` while the
  // logged `tool/call` carries only `<outer>`; the inner call's own arguments
  // are on the `tool/ptc-dispatch-start` row keyed by `subCallId`.
  const outer = 'call_00_jll5n78ecmoe8fcfmcihx10y'
  const child = `${outer}:ptc:1`
  const outerRow = { type: 'tool/call', data: { turn: 1, step: 1, callId: outer, name: 'run_code', arguments: '{"code":"await tools.write({})"}' } }
  const writeArgs = { file_path: '/tmp/ptc.txt', content: 'hello from ptc' }
  const childRow = { type: 'tool/ptc-dispatch-start', data: { rootCallId: outer, parentCallId: outer, subCallId: child, name: 'write', arguments: writeArgs } }

  it('resolves a PTC child call through its sub-dispatch record', () => {
    const session = sessionWith(outerRow, childRow)
    expect(findPresentedCall(session.snapshotEvents(), CallId(child))).toBe(JSON.stringify(writeArgs))
  })

  it('falls back to the enclosing tool/call when no child record exists', () => {
    const session = sessionWith(outerRow)
    expect(findPresentedCall(session.snapshotEvents(), CallId(child))).toBe(outerRow.data.arguments)
  })

  it('walks out of nested PTC ids one level at a time', () => {
    const session = sessionWith(outerRow)
    expect(findPresentedCall(session.snapshotEvents(), CallId(`${child}:ptc:2`))).toBe(outerRow.data.arguments)
  })

  it('reads the settled tool/ptc-dispatch pair when the start row is absent', () => {
    const session = sessionWith(outerRow, {
      type: 'tool/ptc-dispatch',
      data: { rootCallId: outer, parentCallId: outer, subCallId: child, name: 'write', arguments: writeArgs, isError: false, content: [] },
    })
    expect(findPresentedCall(session.snapshotEvents(), CallId(child))).toBe(JSON.stringify(writeArgs))
  })
})

describe('resolvePresentedCall', () => {
  const outer = 'call_ptc_outer'
  const child = `${outer}:ptc:1`
  const writeArgs = { file_path: '/tmp/ptc.txt', content: 'hi' }

  it('prefers the PTC child record and names its source', () => {
    const session = sessionWith(
      { type: 'tool/call', data: { turn: 1, step: 1, callId: outer, name: 'run_code', arguments: '{"code":"x"}' } },
      { type: 'tool/ptc-dispatch-start', data: { rootCallId: outer, parentCallId: outer, subCallId: child, name: 'write', arguments: writeArgs } },
    )
    const lookup = resolvePresentedCall(session.snapshotEvents(), CallId(child))
    expect(lookup).toEqual({
      outcome: 'found',
      call: { callId: child, name: 'write', source: 'tool/ptc-dispatch-start', argumentsText: JSON.stringify(writeArgs) },
    })
  })

  it('labels the enclosing record by the id it actually carries', () => {
    const session = sessionWith(
      { type: 'tool/call', data: { turn: 1, step: 1, callId: outer, name: 'run_code', arguments: '{"code":"x"}' } },
    )
    const lookup = resolvePresentedCall(session.snapshotEvents(), CallId(child))
    expect(lookup.outcome).toBe('found')
    expect(lookup.outcome === 'found' && lookup.call.callId).toBe(outer)
    expect(lookup.outcome === 'found' && lookup.call.name).toBe('run_code')
  })

  it('separates "no row at all" from "row without arguments"', () => {
    const nothing = sessionWith(
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'other', name: 'bash', arguments: '{}' } },
    )
    expect(resolvePresentedCall(nothing.snapshotEvents(), CallId(child))).toEqual({ outcome: 'unresolved', parentCallId: outer })
    expect(resolvePresentedCall(nothing.snapshotEvents(), CallId('native-missing'))).toEqual({ outcome: 'unresolved' })
    const bare = sessionWith(
      { type: 'tool/ptc-dispatch-start', data: { rootCallId: outer, parentCallId: outer, subCallId: child, name: 'write' } },
    )
    expect(resolvePresentedCall(bare.snapshotEvents(), CallId(child))).toEqual({ outcome: 'missing-arguments', source: 'tool/ptc-dispatch-start', callId: child })
  })
})

describe('circuit-breaker folds', () => {
  it('counts the trailing run of denials including risk-policy escalations', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok', escalation: 'risk-policy', outcome: 'rejected' } },
    )
    expect(consecutiveDeniesInOpenTurn(session.snapshotEvents())).toBe(2)
  })

  it('breaks the streak on an allow verdict', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
    )
    expect(consecutiveDeniesInOpenTurn(session.snapshotEvents())).toBe(1)
  })

  it('counts denials inside the recent-verdict window only', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
    )
    expect(deniesInRecentVerdicts(session.snapshotEvents(), 2)).toBe(1)
    expect(deniesInRecentVerdicts(session.snapshotEvents(), 3)).toBe(2)
  })

  it('finds the open turn circuit trip and none otherwise', () => {
    const session = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/circuit', data: { circuitId: 'c1', action: 'delegate', trip: { kind: 'consecutive', count: 3 }, toolName: 'bash' } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', data: { turn: 2 } },
    )
    expect(circuitInOpenTurn(session.snapshotEvents())).toBeUndefined()
    const open = sessionWith(
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'autoReview/circuit', data: { circuitId: 'c2', action: 'reject', trip: { kind: 'window', count: 10 }, toolName: 'write' } },
    )
    expect(circuitInOpenTurn(open.snapshotEvents())?.circuitId).toBe('c2')
  })
})

describe('override folds', () => {
  it('lists recent denials newest first', () => {
    const session = sessionWith(
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'first' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'write', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'second' } },
    )
    expect(lastDeniedVerdicts(session.snapshotEvents(), 5).map(d => d.reviewId)).toEqual(['r3', 'r1'])
  })

  it('keeps an override active until the next same-tool verdict or its TTL', () => {
    const session = sessionWith(
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/override', data: { reviewId: 'r1', toolName: 'bash' } },
    )
    const overrideEvent = session.snapshotEvents().find(event => event.type === 'autoReview/override')!
    expect(activeOverride(session.snapshotEvents(), 'bash', 60_000, overrideEvent.time + 1)).toBe('r1')
    expect(activeOverride(session.snapshotEvents(), 'bash', 60_000, overrideEvent.time + 60_001)).toBeUndefined()
    expect(activeOverride(session.snapshotEvents(), 'write', 60_000, overrideEvent.time + 1)).toBeUndefined()
  })

  it('is consumed by the next same-tool verdict', () => {
    const session = sessionWith(
      { type: 'autoReview/override', data: { reviewId: 'r1', toolName: 'bash' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'bash', provider: 'fork', durationMs: 1, decision: 'allow', reason: 'ok' } },
    )
    const verdictEvent = session.snapshotEvents().find(event => event.type === 'autoReview/verdict')!
    expect(activeOverride(session.snapshotEvents(), 'bash', 60_000, verdictEvent.time + 1)).toBeUndefined()
  })
})

describe('review statistics', () => {
  it('folds counts, mean duration, and the recent verdicts', () => {
    const session = sessionWith(
      { type: 'autoReview/verdict', data: { reviewId: 'r1', approvalId: 'a1', toolName: 'bash', provider: 'fork', durationMs: 10, decision: 'allow', reason: 'ok' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r2', approvalId: 'a2', toolName: 'write', provider: 'fork', durationMs: 30, decision: 'deny', reason: 'no' } },
      { type: 'autoReview/verdict', data: { reviewId: 'r3', approvalId: 'a3', toolName: 'bash', provider: 'fork', durationMs: 5, fallback: 'timeout' } },
    )
    expect(reviewStats(session.snapshotEvents())).toMatchObject({
      allows: 1,
      denies: 1,
      fallbacks: 1,
      avgDurationMs: 20,
    })
    expect(reviewStats(session.snapshotEvents()).recent.map(verdict => verdict.reviewId)).toEqual(['r3', 'r2', 'r1'])
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
    expect(openTurnVerdicts(session.snapshotEvents()).map(verdict => verdict.reviewId)).toEqual(['r2'])
  })
})
