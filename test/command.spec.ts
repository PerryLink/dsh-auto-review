/**
 * `/auto-review` command tests: on/off/status semantics, the durable state
 * override (cross-restore replay), the injected switch notice, and usage
 * errors.
 * @module dsh-auto-review/test/command.spec
 */

import { describe, expect, it } from 'vitest'
import { CommandId } from '@deepseek-ai/dsh-commands'
import { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { effectiveAutoReviewState } from '../src/index.ts'
import { makeAgent, mountHarness } from './harness.ts'

function invoke(definition: CommandDefinition | undefined, harness: Awaited<ReturnType<typeof mountHarness>>, rawInput: string) {
  if (definition === undefined) throw new Error('command was never registered')
  return definition.handler({
    commandId: CommandId('cmd-1'),
    agent: harness.agent,
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
  })
}

/** Mount with the unmarked-audit opt-in (the released rc test peers need it for durable state events to reach the log). */
function auditHarness(config: Record<string, unknown> = {}): ReturnType<typeof mountHarness> {
  return mountHarness({ allowUnmarkedAudit: true, ...config })
}

describe('/auto-review command', () => {
  it('registers the command with its usage hint', async () => {
    const harness = await mountHarness()
    expect(harness.commands.registered).toHaveLength(1)
    expect(harness.commands.registered[0]).toMatchObject({
      name: 'auto-review',
      input: { hint: 'on|off|status|approve [n]' },
    })
  })

  it('status reports the default when no override exists', async () => {
    const harness = await mountHarness()
    const result = invoke(harness.commands.registered[0], harness, 'status')
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toContain('Auto-review is ON for this session.')
  })

  it('switches off: durable state event + model-visible switch notice', async () => {
    const harness = await auditHarness()
    const result = invoke(harness.commands.registered[0], harness, 'off')
    expect(result).toMatchObject({ kind: 'success' })
    const state = harness.session.snapshotEvents().find(event => event.type === 'autoReview/state')
    expect(state?.data).toEqual({ enabled: false })
    expect(harness.injected).toHaveLength(1)
    expect(harness.injected[0]!.content[0]).toMatchObject({ type: 'text' })
    expect((harness.injected[0]!.content[0] as { text: string }).text).toContain('switched OFF')
    expect(effectiveAutoReviewState(harness.session.snapshotEvents())).toBe(false)
  })

  it('switches back on and reports the change idempotently', async () => {
    const harness = await auditHarness()
    invoke(harness.commands.registered[0], harness, 'off')
    const result = invoke(harness.commands.registered[0], harness, 'on')
    expect(result).toMatchObject({ kind: 'success' })
    expect(effectiveAutoReviewState(harness.session.snapshotEvents())).toBe(true)
    const again = invoke(harness.commands.registered[0], harness, 'on')
    expect((again as { text: string }).text).toContain('already ON')
    expect(harness.injected).toHaveLength(2)
  })

  it('rejects unknown arguments', async () => {
    const harness = await mountHarness()
    const result = invoke(harness.commands.registered[0], harness, 'maybe')
    expect(result).toMatchObject({ kind: 'error' })
  })

  it('survives restore: the state override folds from a replayed session log', async () => {
    const harness = await auditHarness()
    invoke(harness.commands.registered[0], harness, 'off')
    const restored = Session.create(SessionId('restored'), harness.session.snapshotEvents())
    expect(effectiveAutoReviewState(restored.snapshotEvents())).toBe(false)
    // A fresh session created from the same durable events delegates too.
    const agent = makeAgent(restored)
    expect(agent.session.snapshotEvents().some(event => event.type === 'autoReview/state')).toBe(true)
  })

  it('records a one-shot override for a recent denial', async () => {
    const harness = await auditHarness()
    const append = harness.session.append as unknown as (type: string, data: unknown) => unknown
    append.call(harness.session, 'approval/asked', { id: 'a1', toolName: 'bash' })
    append.call(harness.session, 'autoReview/verdict', {
      reviewId: 'r1',
      approvalId: 'a1',
      toolName: 'bash',
      provider: 'fork',
      durationMs: 5,
      decision: 'deny',
      reason: 'no',
      outcome: 'rejected',
    })
    const result = invoke(harness.commands.registered[0], harness, 'approve')
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toContain('Authorized ONE retry')
    const override = harness.session.snapshotEvents().find(event => event.type === 'autoReview/override')
    expect(override?.data).toEqual({ reviewId: 'r1', toolName: 'bash' })
  })

  it('errors on approve without a recent denial', async () => {
    const harness = await mountHarness()
    const result = invoke(harness.commands.registered[0], harness, 'approve 2')
    expect(result).toMatchObject({ kind: 'error' })
    expect((result as { text: string }).text).toContain('No recent denial')
  })

  it('rejects an invalid approve index', async () => {
    const harness = await mountHarness()
    const result = invoke(harness.commands.registered[0], harness, 'approve 0')
    expect(result).toMatchObject({ kind: 'error' })
    expect((result as { text: string }).text).toContain('Invalid /auto-review approve index')
  })

  it('reports cumulative statistics in status', async () => {
    const harness = await auditHarness()
    const append = harness.session.append as unknown as (type: string, data: unknown) => unknown
    append.call(harness.session, 'approval/asked', { id: 'a1', toolName: 'bash' })
    append.call(harness.session, 'autoReview/verdict', {
      reviewId: 'r1',
      approvalId: 'a1',
      toolName: 'bash',
      provider: 'fork',
      durationMs: 10,
      decision: 'allow',
      reason: 'ok',
      outcome: 'allowed-once',
    })
    append.call(harness.session, 'approval/asked', { id: 'a2', toolName: 'write' })
    append.call(harness.session, 'autoReview/verdict', {
      reviewId: 'r2',
      approvalId: 'a2',
      toolName: 'write',
      provider: 'fork',
      durationMs: 20,
      fallback: 'timeout',
      error: 'slow',
      outcome: 'rejected',
    })
    append.call(harness.session, 'approval/asked', { id: 'a3', toolName: 'edit' })
    append.call(harness.session, 'autoReview/rejection', {
      rejectionId: 'n1',
      approvalId: 'a3',
      toolName: 'edit',
      reason: 'toolsPolicy.overrides.edit',
      outcome: 'rejected',
    })
    const result = invoke(harness.commands.registered[0], harness, 'status')
    const text = (result as { text: string }).text
    expect(text).toContain('All-time: 1 allows, 0 denies, 1 fallbacks, 1 never rejects (avg 10 ms per verdict).')
    expect(text).toContain('Recent verdicts: write: fallback(timeout), bash: allow')
  })

  it('reports a tripped circuit breaker in status', async () => {
    const harness = await auditHarness()
    const append = harness.session.append as unknown as (type: string, data: unknown) => unknown
    append.call(harness.session, 'autoReview/circuit', {
      circuitId: 'c1',
      action: 'reject',
      trip: { kind: 'window', count: 6 },
      toolName: 'write',
    })
    const result = invoke(harness.commands.registered[0], harness, 'status')
    const text = (result as { text: string }).text
    expect(text).toContain('Rejection circuit breaker tripped (window: 6 denials); later requests in this turn follow "reject".')
  })

  it('serves Chinese command output when language is zh', async () => {
    const harness = await mountHarness({ language: 'zh' })
    const result = invoke(harness.commands.registered[0], harness, 'status')
    expect((result as { text: string }).text).toContain('本会话的自动审查已开启。')
    expect(harness.commands.registered[0]!.description).toContain('第二模型')
    const bad = invoke(harness.commands.registered[0], harness, 'maybe')
    expect((bad as { text: string }).text).toContain('未知的 /auto-review 参数')
  })
})
