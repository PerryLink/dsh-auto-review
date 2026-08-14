/**
 * Invariant companion tests: fixture session logs must replay cleanly when
 * valid and fail loudly when the audit chain or the model-visible ⟺ logged
 * marker link is broken.
 * @module dsh-auto-review/test/invariant.spec
 */

import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import { describe, expect, it } from 'vitest'
import * as AutoReviewInvariant from '../src/invariant.ts'
import { AutoReviewVerdictId } from '../src/index.ts'

function fixtureEvents(name: string): unknown {
  const url = new URL(`../fixtures/sessions/${name}`, import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')).events
}

async function mount(fixture?: string): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId(`fixture-${fixture ?? 'empty'}`), {
    ...fixture !== undefined ? { seed: fixtureEvents(fixture) as never } : {},
  })
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(AutoReviewInvariant)
  return { ctx, session }
}

function appendToolResult(session: Session, callId: string, text: string): void {
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId: CallId(callId),
      content: [{ type: 'text', text }],
      isError: true,
    }),
  }, { surfaceOp: 'append' })
}

describe('auto-review invariants', () => {
  it('replays a complete valid deny chain without failures', async () => {
    await expect(mount('valid-deny-verdict.json')).resolves.toBeDefined()
  })

  it('fails a log whose deny marker references no verdict (model-visible ⟺ logged)', async () => {
    await expect(mount('deny-marker-orphan.json')).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: 'dsh-auto-review',
    })
  })

  it('fails a log whose verdict references no approval/asked', async () => {
    await expect(mount('verdict-orphan-asked.json')).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: 'dsh-auto-review',
    })
  })

  it('fails a log whose verdict carries both verdict and fallback fields', async () => {
    await expect(mount('verdict-mixed-fields.json')).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: 'dsh-auto-review',
    })
  })

  it('fails a log with two verdicts for one approval/asked', async () => {
    await expect(mount('verdict-duplicate-approval.json')).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: 'dsh-auto-review',
    })
  })

  it('fails a log whose verdict outcome contradicts approval/decided', async () => {
    await expect(mount('verdict-outcome-mismatch.json')).rejects.toMatchObject({
      code: 'INVARIANT',
      packageName: 'dsh-auto-review',
    })
  })

  it('accepts an incrementally appended valid chain', async () => {
    const { session } = await mount()
    session.append('turn/start', { turn: 1 })
    session.append('approval/asked', {
      id: ApprovalRequestId('a-live'),
      toolName: 'bash',
      callId: CallId('call-live'),
    })
    expect(() => {
      session.append('autoReview/verdict', {
        reviewId: AutoReviewVerdictId('r-live'),
        approvalId: ApprovalRequestId('a-live'),
        toolName: 'bash',
        callId: CallId('call-live'),
        provider: 'fork',
        durationMs: 10,
        decision: 'deny',
        reason: 'dangerous',
        outcome: 'rejected',
      })
      appendToolResult(session, 'call-live', 'Error: [auto-review] review r-live denied tool "bash": dangerous')
    }).not.toThrow()
  })

  it('fails a repeated reviewId', async () => {
    const { session } = await mount()
    session.append('approval/asked', { id: ApprovalRequestId('a-dup'), toolName: 'bash' })
    const verdict = {
      reviewId: AutoReviewVerdictId('r-dup'),
      approvalId: ApprovalRequestId('a-dup'),
      toolName: 'bash',
      provider: 'fork',
      durationMs: 1,
      decision: 'allow' as const,
      reason: 'ok',
    }
    session.append('autoReview/verdict', verdict)
    expect(() => session.append('autoReview/verdict', verdict)).toThrow(/repeats reviewId/u)
  })

  it('fails a deny marker whose verdict decided allow', async () => {
    const { session } = await mount()
    session.append('approval/asked', {
      id: ApprovalRequestId('a-mismatch'),
      toolName: 'bash',
      callId: CallId('call-mismatch'),
    })
    session.append('autoReview/verdict', {
      reviewId: AutoReviewVerdictId('r-mismatch'),
      approvalId: ApprovalRequestId('a-mismatch'),
      toolName: 'bash',
      callId: CallId('call-mismatch'),
      provider: 'fork',
      durationMs: 1,
      decision: 'allow',
      reason: 'ok',
    })
    expect(() => {
      appendToolResult(session, 'call-mismatch', 'Error: [auto-review] review r-mismatch denied tool "bash": why')
    }).toThrow(/non-deny verdict/u)
  })

  it('accepts a fallback marker linking a rejected fallback verdict', async () => {
    const { session } = await mount()
    session.append('turn/start', { turn: 1 })
    session.append('approval/asked', {
      id: ApprovalRequestId('a-fallback'),
      toolName: 'bash',
      callId: CallId('call-fallback'),
    })
    session.append('autoReview/verdict', {
      reviewId: AutoReviewVerdictId('r-fallback'),
      approvalId: ApprovalRequestId('a-fallback'),
      toolName: 'bash',
      callId: CallId('call-fallback'),
      provider: 'fork',
      durationMs: 10,
      fallback: 'timeout',
      error: 'reviewer exceeded 60000 ms',
      outcome: 'rejected',
    })
    expect(() => {
      appendToolResult(session, 'call-fallback', 'Error: [auto-review-fallback] review r-fallback failed (timeout) and the request was rejected: reviewer exceeded 60000 ms')
    }).not.toThrow()
  })

  it('fails a fallback marker whose verdict was not rejected by fallback', async () => {
    const { session } = await mount()
    session.append('approval/asked', {
      id: ApprovalRequestId('a-fallback-delegate'),
      toolName: 'bash',
      callId: CallId('call-fallback-delegate'),
    })
    session.append('autoReview/verdict', {
      reviewId: AutoReviewVerdictId('r-fallback-delegate'),
      approvalId: ApprovalRequestId('a-fallback-delegate'),
      toolName: 'bash',
      callId: CallId('call-fallback-delegate'),
      provider: 'fork',
      durationMs: 1,
      fallback: 'unavailable',
      error: 'reviewer subagent failed',
    })
    expect(() => {
      appendToolResult(session, 'call-fallback-delegate', 'Error: [auto-review-fallback] review r-fallback-delegate failed (unavailable) and the request was rejected: reviewer subagent failed')
    }).toThrow(/not rejected by fallback/u)
  })

  it('fails a fallback marker referencing an unknown reviewId', async () => {
    const { session } = await mount()
    expect(() => {
      appendToolResult(session, 'call-orphan-fallback', 'Error: [auto-review-fallback] review r-ghost failed (timeout) and the request was rejected: no reviewer')
    }).toThrow(/unknown reviewId/u)
  })
})
