import { describe, expect, it, vi } from 'vitest'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { DetailedAnswer, ReviewReceipt } from '../src/index.ts'
import { appendRequestHeader, mountHarness } from './harness.ts'
import { CallId } from './call-id.ts'

const allow = async (): Promise<ApprovalOutcome> => 'allowed-once'
const ai = { toolsPolicy: { overrides: { bash: 'ai' } } }

function requestFor(harness: Awaited<ReturnType<typeof mountHarness>>, id = 'one', correlated = true): ApprovalRequest {
  const request = { agent: harness.agent, toolName: 'bash', callId: CallId(id) }
  if (correlated) {
    harness.session.append('approval/asked', { id: `asked-${id}` as never, toolName: 'bash', callId: request.callId })
  }
  return request
}

function receiptOf(answer: DetailedAnswer): ReviewReceipt {
  return answer.receipt
}

describe('request-local structured receipts', () => {
  it('attributes a concurrent circuit trip to exactly its creating request', async () => {
    let release!: () => void
    const bothStarted = new Promise<void>(resolve => {
      release = resolve
    })
    let starts = 0
    const harness = await mountHarness({ ...ai, circuitBreaker: { consecutiveDenies: 1 } }, () => ({
      verdict: { decision: 'deny', reason: 'unsafe' },
      onStart: async () => {
        starts += 1
        if (starts === 2) {
          release()
        }
        await bothStarted
      },
    }))
    const runtime = harness.ctx.autoReviewRuntime
    const first = requestFor(harness, 'first')
    const second = requestFor(harness, 'second')
    const answers = await Promise.all([runtime.answerDetailed(first, allow), runtime.answerDetailed(second, allow)])
    expect(answers.map(answer => answer.receipt.circuitTriggered)).toEqual([true, false])
    runtime.dispose()
  })

  it('does not expose mutable circuit state, including the nested trip', async () => {
    const harness = await mountHarness({ ...ai, circuitBreaker: { consecutiveDenies: 1 } }, () => ({ verdict: { decision: 'deny', reason: 'unsafe' } }))
    const runtime = harness.ctx.autoReviewRuntime
    const first = await runtime.answerDetailed(requestFor(harness), allow)
    expect(first.receipt.circuit).toBeDefined()
    if (first.receipt.circuit !== undefined) {
      first.receipt.circuit.action = 'reject'
      first.receipt.circuit.trip.count = 999
    }
    const second = await runtime.answerDetailed(requestFor(harness, 'two'), allow)
    expect(second.outcome).toBe('allowed-once')
    expect(second.receipt.circuit?.action).toBe('delegate')
    expect(second.receipt.circuit?.trip.count).toBe(1)
    if (second.receipt.circuit !== undefined) {
      second.receipt.circuit.trip.count = 777
    }
    const third = await runtime.answerDetailed(requestFor(harness, 'three'), allow)
    expect(third.receipt.circuit?.trip.count).toBe(1)
    runtime.dispose()
  })

  it.each(['allow', 'deny'] as const)('records %s with public association and no custom audit writes', async decision => {
    const harness = await mountHarness(ai, () => ({ verdict: { decision, reason: 'evidence' } }))
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness), allow)
    expect(receiptOf(answer)).toMatchObject({ sessionId: 'harness-session', approvalId: 'asked-one', callId: 'one', category: 'review', decision, reason: 'evidence', configuredReviewerBackend: 'mock', cached: false })
    expect(answer.outcome).toBe(decision === 'allow' ? 'allowed-once' : 'rejected')
    expect(harness.session.snapshotEvents().some(event => event.type.startsWith('autoReview/'))).toBe(false)
  })

  it.each([
    [{ enableByDefault: false }, 'session-disabled'],
    [{ toolsPolicy: { default: 'human' } }, 'human-policy'],
    [{ toolsPolicy: { overrides: { bash: 'never' } } }, 'policy'],
  ] as const)('records policy branch %s', async (config, reason) => {
    const harness = await mountHarness(config)
    const next = vi.fn(allow)
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness), next)
    if (reason === 'policy') {
      expect(answer.receipt.category).toBe('policy')
      expect(next).not.toHaveBeenCalled()
    } else {
      expect(answer.receipt.reason).toBe(reason)
      expect(answer.receipt.delegated).toBe(true)
      expect(next).toHaveBeenCalledOnce()
    }
  })

  it('reports missing association without inventing an approval id', async () => {
    const harness = await mountHarness(ai)
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness, 'missing', false), allow)
    expect(answer.receipt).toMatchObject({ category: 'fault', fallback: 'unavailable' })
    expect(answer.receipt.approvalId).toBeUndefined()
    expect(answer.outcome).toBe('rejected')
  })

  it.each(['rejected', 'allow-once', 'delegate'] as const)('preserves %s reviewer-failure fallback', async fallbackPolicy => {
    const harness = await mountHarness({ ...ai, fallbackPolicy }, () => ({ failStart: new Error('offline') }))
    const next = vi.fn(allow)
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness), next)
    expect(answer.receipt.category).toBe('fault')
    expect(answer.outcome).toBe(fallbackPolicy === 'rejected' ? 'rejected' : 'allowed-once')
    expect(next.mock.calls.length).toBe(fallbackPolicy === 'delegate' ? 1 : 0)
  })

  it('only the detailed API catches downstream exceptions', async () => {
    const harness = await mountHarness({ enableByDefault: false })
    const request = requestFor(harness)
    const fail = async (): Promise<ApprovalOutcome> => {
      throw new Error('downstream failed')
    }
    await expect(harness.ctx.autoReviewRuntime.answer(request, fail)).rejects.toThrow('downstream failed')
    expect(await harness.ctx.autoReviewRuntime.answerDetailed(request, fail)).toMatchObject({ outcome: 'rejected', receipt: { category: 'fault', fallback: 'unavailable', reason: 'downstream failed' } })
  })

  it('rejects detailed late downstream results without changing scalar disposal semantics', async () => {
    const harness = await mountHarness({ enableByDefault: false })
    const runtime = harness.ctx.autoReviewRuntime
    let finish!: (outcome: ApprovalOutcome) => void
    const pending = new Promise<ApprovalOutcome>(resolve => {
      finish = resolve
    })
    const answer = runtime.answerDetailed(requestFor(harness), () => pending)
    runtime.dispose()
    finish('allowed-once')
    expect(await answer).toMatchObject({ outcome: 'rejected', receipt: { reason: 'runtime-disposed' } })
    expect(await runtime.answer(requestFor(harness, 'scalar'), allow)).toBe('allowed-once')
    const next = vi.fn(allow)
    expect((await runtime.answerDetailed(requestFor(harness, 'disposed'), next)).outcome).toBe('rejected')
    expect(next).not.toHaveBeenCalled()
  })

  it.each(['deny', 'delegate'] as const)('keeps reviewer decision separate from risk-policy %s', async onHighRisk => {
    const harness = await mountHarness({ ...ai, riskPolicy: { maxAutoAllow: 'low', onHighRisk } }, () => ({ verdict: { decision: 'allow', reason: 'high risk', riskLevel: 'high' } }))
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness), allow)
    expect(answer.receipt).toMatchObject({ decision: 'allow', escalation: 'risk-policy' })
    expect(answer.outcome).toBe(onHighRisk === 'deny' ? 'rejected' : 'allowed-once')
    expect(answer.receipt.delegated === true).toBe(onHighRisk === 'delegate')
  })

  it.each(['review', 'failure'] as const)('records the independent %s budget', async kind => {
    const harness = await mountHarness({ ...ai, maxReviewsPerTurn: 1, maxFailuresPerTurn: 1 }, () => kind === 'review' ? { verdict: { decision: 'allow', reason: 'safe' } } : { stopReason: 'error' })
    await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness), allow)
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness, 'two'), allow)
    expect(answer.receipt).toMatchObject({ category: 'delegate', reason: `${kind}-budget`, delegated: true })
  })

  it('records cache reuse without another reviewer run', async () => {
    const harness = await mountHarness({ ...ai, contextBudget: { turns: 0 } })
    for (const id of ['one', 'two']) {
      harness.session.append('tool/call', { turn: 1, step: 1, callId: CallId(id), name: 'bash', arguments: '{}' } as never)
      const answer = await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness, id), allow)
      expect(answer.receipt.cached).toBe(id === 'two')
    }
    expect(harness.subagents.starts).toHaveLength(1)
  })

  it('records cancellation separately from reviewer faults', async () => {
    const harness = await mountHarness(ai, () => ({ delayMs: 20 }))
    const controller = new AbortController()
    const request = { ...requestFor(harness), signal: controller.signal }
    const pending = harness.ctx.autoReviewRuntime.answerDetailed(request, allow)
    controller.abort()
    const answer = await pending
    expect(answer).toMatchObject({ outcome: 'cancelled', receipt: { category: 'cancelled', fallback: 'cancelled' } })
  })

  it('rejects a late reviewer allow after disposal', async () => {
    const harness = await mountHarness(ai, () => ({ verdict: { decision: 'allow', reason: 'safe' }, delayMs: 10 }))
    const pending = harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness), allow)
    harness.ctx.autoReviewRuntime.dispose()
    expect(await pending).toMatchObject({ outcome: 'rejected', receipt: { reason: 'runtime-disposed' } })
  })

  it('delegates a live reviewer child without recursively reviewing it', async () => {
    const harness = await mountHarness(ai)
    let release!: () => void
    const held = new Promise<void>(resolve => {
      release = resolve
    })
    const start = harness.subagents.start!
    harness.subagents.start = async (name, request) => {
      const run = await start(name, request)
      return { ...run, result: held.then(() => run.result) }
    }
    const pending = harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness), allow)
    // 等待 start 的微任务完成注册，同时用屏障固定子会话的存活期。
    await new Promise<void>(resolve => setImmediate(resolve))
    const child = { ...requestFor(harness, 'child'), agent: { ...harness.agent, id: 'reviewer-session' as never } }
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed(child, allow)
    expect(answer.receipt).toMatchObject({ reason: 'reviewer-recursion', delegated: true })
    release()
    await pending
    expect(harness.subagents.starts).toHaveLength(1)
  })

  it('supports tool-only correlation when callId is absent', async () => {
    const harness = await mountHarness(ai)
    harness.session.append('approval/asked', { id: 'tool-only' as never, toolName: 'bash' })
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed({ agent: harness.agent, toolName: 'bash' }, allow)
    expect(answer.receipt.approvalId).toBe('tool-only')
    expect(answer.receipt.callId).toBeUndefined()
    expect(answer.outcome).toBe('allowed-once')
  })

  it('catches internal event-reader errors only in the detailed interface', async () => {
    const harness = await mountHarness(ai)
    const request = requestFor(harness)
    vi.spyOn(harness.session, 'snapshotEvents').mockImplementation(() => {
      throw new Error('event reader failed')
    })
    expect(() => harness.ctx.autoReviewRuntime.answer(request, allow)).toThrow('event reader failed')
    expect(await harness.ctx.autoReviewRuntime.answerDetailed(request, allow)).toMatchObject({ outcome: 'rejected', receipt: { fallback: 'unavailable', reason: 'event reader failed' } })
  })

  it('returns structured evidence on the inline reviewer backend', async () => {
    const harness = await mountHarness(ai, () => ({ verdict: { decision: 'allow', reason: 'inline safe' } }), {}, undefined, 'inline')
    appendRequestHeader(harness.session, { provider: 'mock-model-provider', model: 'mock-model' })
    const answer = await harness.ctx.autoReviewRuntime.answerDetailed(requestFor(harness), allow)
    expect(answer).toMatchObject({ outcome: 'allowed-once', receipt: { category: 'review', decision: 'allow', reason: 'inline safe' } })
    expect(harness.llm.calls).toHaveLength(1)
    expect(harness.subagents.starts).toHaveLength(0)
  })
})
