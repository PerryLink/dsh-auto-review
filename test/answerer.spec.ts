/**
 * Answerer unit tests: claiming vs delegating vs failing closed, policy
 * resolution order, anti-recursion, the per-turn budget, and the complete
 * audit chain through the real ApprovalService.
 * @module dsh-auto-review/test/answerer.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { FALLBACK_MARKER_PATTERN } from '../src/index.ts'
import {
  dispatchApproval,
  dispatchAskedApproval,
  dispatchPostExecute,
  mountHarness,
} from './harness.ts'

const next: () => Promise<ApprovalOutcome> = () => Promise.resolve('allowed-once')

function lastEvent<T extends { type: string; data: unknown }>(events: readonly T[], type: string): T | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as T
    if (event.type === type) return event
  }
  return undefined
}

/** Unwrap a session event's payload for property assertions. */
function dataOf(event: { data: unknown } | undefined): Record<string, unknown> {
  return (event?.data ?? {}) as Record<string, unknown>
}

describe('auto-review answerer', () => {
  it('claims an ai-listed tool and grants on an allow verdict', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    const { outcome, askedId } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-1'),
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('allowed-once')
    expect(harness.subagents.starts).toHaveLength(1)
    const verdict = lastEvent(harness.session.events, 'autoReview/verdict')
    expect(verdict).toBeDefined()
    expect(verdict?.data).toMatchObject({
      approvalId: askedId,
      toolName: 'bash',
      callId: 'call-1',
      decision: 'allow',
      reason: 'looks safe',
      outcome: 'allowed-once',
    })
  })

  it('requests the ignorable envelope marker so any harness build can load the log', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    const append = vi.spyOn(harness.session, 'append')
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-1'),
      reason: 'escalate sandbox',
    }, next)
    const verdictCall = append.mock.calls.find(([type]) => type === 'autoReview/verdict')
    expect(verdictCall).toBeDefined()
    expect(verdictCall?.[2]).toEqual({ ignorable: true })
  })

  it('delegates tools not covered by the policy table (default human)', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    let downstreamCalled = false
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'web_fetch',
      reason: 'outbound fetch',
    }, async () => {
      downstreamCalled = true
      return 'rejected'
    })
    expect(outcome).toBe('rejected')
    expect(downstreamCalled).toBe(true)
    expect(harness.subagents.starts).toHaveLength(0)
    expect(lastEvent(harness.session.events, 'autoReview/verdict')).toBeUndefined()
  })

  it('delegates everything when the session has auto-review switched off', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    harness.session.append('autoReview/state', { enabled: false })
    let downstreamCalled = false
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => {
      downstreamCalled = true
      return 'rejected'
    })
    expect(outcome).toBe('rejected')
    expect(downstreamCalled).toBe(true)
    expect(harness.subagents.starts).toHaveLength(0)
  })

  it('delegates everything when enableByDefault is false', async () => {
    const harness = await mountHarness({ enableByDefault: false, toolsPolicy: { overrides: { bash: 'ai' } } })
    let downstreamCalled = false
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => {
      downstreamCalled = true
      return 'rejected'
    })
    expect(downstreamCalled).toBe(true)
    expect(harness.subagents.starts).toHaveLength(0)
  })

  it('rejects deterministically for a never-listed tool without asking anyone', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'never' } } })
    let downstreamCalled = false
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => {
      downstreamCalled = true
      return 'allowed-once'
    })
    expect(outcome).toBe('rejected')
    expect(downstreamCalled).toBe(false)
    expect(harness.subagents.starts).toHaveLength(0)
  })

  it('lets risk rules win over tool overrides', async () => {
    const harness = await mountHarness({
      toolsPolicy: { overrides: { bash: 'ai' } },
      riskRules: [{ pattern: 'killall', policy: 'never' }],
    })
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'killall cleanup',
    }, next)
    expect(outcome).toBe('rejected')
    expect(harness.subagents.starts).toHaveLength(0)
  })

  it('lets a risk rule route a human-default tool to AI review', async () => {
    const harness = await mountHarness({
      riskRules: [{ pattern: '^(?=.*sandbox)', policy: 'ai' }],
    })
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'write',
      reason: 'sandbox escalation to workspace-write',
    }, next)
    expect(harness.subagents.starts).toHaveLength(1)
  })

  it('never re-reviews a reviewer child\'s own approval asks (anti-recursion)', async () => {
    const harness = await mountHarness({
      toolsPolicy: { overrides: { bash: 'ai' } },
      reviewerTimeoutMs: 1000,
    }, () => ({ verdict: { decision: 'allow', reason: 'ok' }, delayMs: 40 }))
    const pending = dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    // While the review runs, the reviewer child (mock run id) asks approval.
    await new Promise<void>(resolve => setTimeout(resolve, 5))
    let downstreamCalled = false
    const reviewerAgent = { ...harness.agent, id: 'reviewer-session' as never }
    const nested = await dispatchApproval(harness.ctx, {
      agent: reviewerAgent as never,
      toolName: 'bash',
    }, async () => {
      downstreamCalled = true
      return 'rejected'
    })
    expect(nested).toBe('rejected')
    expect(downstreamCalled).toBe(true)
    expect(await pending).toMatchObject({ outcome: 'allowed-once' })
  })

  it('fails closed by default when the reviewer cannot deliver a verdict', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({ stopReason: 'error' }),
    )
    let downstreamCalled = false
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => {
      downstreamCalled = true
      return 'allowed-once'
    })
    expect(outcome).toBe('rejected')
    expect(downstreamCalled).toBe(false)
    const verdict = lastEvent(harness.session.events, 'autoReview/verdict')
    expect(verdict?.data).toMatchObject({ fallback: 'unavailable', outcome: 'rejected' })
    expect(verdict?.data).not.toHaveProperty('decision')
  })

  it('delegates on reviewer failure with fallbackPolicy delegate', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, fallbackPolicy: 'delegate' },
      () => ({ stopReason: 'error' }),
    )
    let downstreamCalled = false
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => {
      downstreamCalled = true
      return 'rejected'
    })
    expect(outcome).toBe('rejected')
    expect(downstreamCalled).toBe(true)
    const verdict = lastEvent(harness.session.events, 'autoReview/verdict')
    expect(verdict?.data).toMatchObject({ fallback: 'unavailable' })
    expect(verdict?.data).not.toHaveProperty('outcome')
  })

  it('grants on reviewer failure only with fallbackPolicy allow-readonly', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, fallbackPolicy: 'allow-readonly' },
      () => ({ stopReason: 'error' }),
    )
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(outcome).toBe('allowed-once')
    expect(lastEvent(harness.session.events, 'autoReview/verdict')?.data).toMatchObject({
      fallback: 'unavailable',
      outcome: 'allowed-once',
    })
  })

  it('fails closed on timeout', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, reviewerTimeoutMs: 20 },
      () => ({ verdict: { decision: 'allow', reason: 'late' }, delayMs: 200 }),
    )
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(outcome).toBe('rejected')
    expect(lastEvent(harness.session.events, 'autoReview/verdict')?.data).toMatchObject({
      fallback: 'timeout',
      outcome: 'rejected',
    })
  })

  it('settles cancelled when the request signal aborts mid-review', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({ verdict: { decision: 'allow', reason: 'late' }, delayMs: 60 }),
    )
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      signal: controller.signal,
    }, next)
    expect(outcome).toBe('cancelled')
    expect(lastEvent(harness.session.events, 'autoReview/verdict')?.data).toMatchObject({
      fallback: 'cancelled',
      outcome: 'cancelled',
    })
  })

  it('fails closed on a schema mismatch (no structured verdict)', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({}),
    )
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(outcome).toBe('rejected')
    expect(lastEvent(harness.session.events, 'autoReview/verdict')?.data).toMatchObject({
      fallback: 'schema',
    })
  })

  it('fails closed when the reviewer provider is not registered', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } }, reviewerProvider: 'ghost' })
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(outcome).toBe('rejected')
    expect(lastEvent(harness.session.events, 'autoReview/verdict')?.data).toMatchObject({
      fallback: 'unavailable',
    })
  })

  it('delegates once the per-turn review budget is exhausted', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, maxReviewsPerTurn: 1 },
    )
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(harness.subagents.starts).toHaveLength(1)
    let downstreamCalled = false
    const second = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => {
      downstreamCalled = true
      return 'rejected'
    })
    expect(second.outcome).toBe('rejected')
    expect(downstreamCalled).toBe(true)
    expect(harness.subagents.starts).toHaveLength(1)
  })

  it('records the complete asked → verdict → decided audit chain through the real service', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    const outcome = await harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-audit'),
      reason: 'escalate sandbox',
    })
    expect(outcome).toBe('allowed-once')
    const types = harness.session.events.map(event => event.type)
    expect(types).toEqual(expect.arrayContaining(['approval/asked', 'autoReview/verdict', 'approval/decided']))
    const asked = harness.session.events.find(event => event.type === 'approval/asked')
    const verdict = harness.session.events.find(event => event.type === 'autoReview/verdict')
    const decided = harness.session.events.find(event => event.type === 'approval/decided')
    expect(dataOf(verdict).approvalId).toBe(dataOf(asked).id)
    expect(dataOf(decided).id).toBe(dataOf(asked).id)
    expect(dataOf(decided).outcome).toBe('allowed-once')
  })

  it('cannot bypass the never policy: the service rejects without dispatching any answerer', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      undefined,
      { policy: 'never' },
    )
    const outcome = await harness.ctx.approval.request({
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    })
    expect(outcome).toBe('rejected')
    expect(harness.subagents.starts).toHaveLength(0)
    expect(lastEvent(harness.session.events, 'autoReview/verdict')).toBeUndefined()
  })

  it('denies with the reviewer reason when the verdict says deny', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({ verdict: { decision: 'deny', reason: 'destructive and irreversible', riskLevel: 'high' } }),
    )
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-deny'),
    }, next)
    expect(outcome).toBe('rejected')
    expect(lastEvent(harness.session.events, 'autoReview/verdict')?.data).toMatchObject({
      decision: 'deny',
      reason: 'destructive and irreversible',
      riskLevel: 'high',
      outcome: 'rejected',
    })
  })

  it('classifies an abort-rejected run as timeout when the timer already fired', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, reviewerTimeoutMs: 20 },
      () => ({ rejectOnAbort: true }),
    )
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(outcome).toBe('rejected')
    expect(lastEvent(harness.session.events, 'autoReview/verdict')?.data).toMatchObject({
      fallback: 'timeout',
      outcome: 'rejected',
    })
  })

  it('classifies a cancelled start as cancelled, not unavailable', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, reviewerTimeoutMs: 1000 },
      () => ({ startDelayMs: 30, failStartOnAbort: true }),
    )
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5)
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      signal: controller.signal,
    }, next)
    expect(outcome).toBe('cancelled')
    expect(lastEvent(harness.session.events, 'autoReview/verdict')?.data).toMatchObject({
      fallback: 'cancelled',
      outcome: 'cancelled',
    })
  })

  it('does not let reviewer failures consume the AI verdict budget', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, maxReviewsPerTurn: 1, maxFailuresPerTurn: 10 },
      () => ({ stopReason: 'error' }),
    )
    const first = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(first.outcome).toBe('rejected')
    const second = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(second.outcome).toBe('rejected')
    expect(harness.subagents.starts).toHaveLength(2)
  })

  it('delegates once the per-turn failure budget is exhausted', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, maxFailuresPerTurn: 1 },
      () => ({ stopReason: 'error' }),
    )
    const first = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, next)
    expect(first.outcome).toBe('rejected')
    let downstreamCalled = false
    const second = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => {
      downstreamCalled = true
      return 'allowed-once'
    })
    expect(second.outcome).toBe('allowed-once')
    expect(downstreamCalled).toBe(true)
    expect(harness.subagents.starts).toHaveLength(1)
  })

  it('injects an auditable failure text when the fallback rejects', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({ stopReason: 'error' }),
    )
    const callId = CallId('call-fallback')
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
    }, next)
    const decision = await dispatchPostExecute(harness.ctx, { callId } as never, {
      isError: true,
      content: [{ type: 'text', text: 'Error: the user rejected tool "bash"' }],
    }, async () => ({ kind: 'accept' }))
    expect(decision).toMatchObject({ kind: 'block' })
    const feedback = (decision as { feedback: { text: string }[] }).feedback
    expect(feedback[0]!.text).toMatch(FALLBACK_MARKER_PATTERN)
    expect(feedback[0]!.text).toContain('unavailable')
  })

  it('does not inject failure feedback when the fallback delegates', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } }, fallbackPolicy: 'delegate' },
      () => ({ stopReason: 'error' }),
    )
    const callId = CallId('call-fallback-delegate')
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
    }, next)
    let downstreamCalled = false
    const decision = await dispatchPostExecute(harness.ctx, { callId } as never, {
      isError: true,
      content: [{ type: 'text', text: 'Error: rejected' }],
    }, async () => {
      downstreamCalled = true
      return { kind: 'accept' }
    })
    expect(decision).toMatchObject({ kind: 'accept' })
    expect(downstreamCalled).toBe(true)
  })
})
