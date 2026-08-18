/**
 * The rc.6-safe degraded path: on hosts whose `Session.append` drops the
 * `ignorable` envelope marker (the 0.1.0-rc.6 peers this suite runs
 * against), the runtime must NEVER write unmarked `autoReview/*` events —
 * they would make sessions unresumable on stricter harness builds. Instead
 * it degrades to an in-memory mirror: marker-free feedback, in-memory
 * budgets/breaker/override/approve, and a status notice. The append probe
 * for unversioned hosts is covered last.
 * @module dsh-auto-review/test/audit-degradation.spec
 */

import { describe, expect, it, vi } from 'vitest'
import { CallId } from '@deepseek-ai/dsh-llm'
import { CommandId } from '@deepseek-ai/dsh-commands'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { dispatchAskedApproval, dispatchPostExecute, mountHarness, type ScriptedReview } from './harness.ts'

vi.mock('../src/audit.ts', async importOriginal => {
  const original = await importOriginal() as typeof import('../src/audit.ts')
  return { ...original, peerSessionVersion: vi.fn(() => '0.1.0-rc.6') }
})

const next: () => Promise<string> = () => Promise.resolve('allowed-once')

function invoke(definition: CommandDefinition | undefined, harness: Awaited<ReturnType<typeof mountHarness>>, rawInput: string) {
  if (definition === undefined) throw new Error('command was never registered')
  return definition.handler({
    commandId: CommandId('cmd-1'),
    agent: harness.agent,
    rawInput,
    signal: new AbortController().signal,
  })
}

function denyScript(): ScriptedReview {
  return { verdict: { decision: 'deny', reason: 'destructive' } }
}

describe('audit-disabled degradation (rc.6 host)', () => {
  it('writes no autoReview events to the session log on a deny', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } }, denyScript)
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-clean'),
    }, next)
    expect(outcome).toBe('rejected')
    expect(harness.session.events.some(event => event.type.startsWith('autoReview/'))).toBe(false)
  })

  it('injects a marker-free deny reason (the logged tool result is the audit)', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } }, denyScript)
    const callId = CallId('call-plain-feedback')
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
    expect(feedback[0]!.text).toContain('destructive')
    expect(feedback[0]!.text).not.toMatch(/\[auto-review/u)
    expect(feedback[0]!.text).toContain('Do not attempt to work around this denial')
  })

  it('reports the disabled-audit notice in /auto-review status', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    const result = invoke(harness.commands.registered[0], harness, 'status')
    const text = (result as { text: string }).text
    expect(text).toContain('Session-log audit is disabled on this host')
    expect(text).toContain('allowUnmarkedAudit: true')
  })

  it('keeps the on/off override in memory without writing a state event', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    const off = invoke(harness.commands.registered[0], harness, 'off')
    expect(off).toMatchObject({ kind: 'success' })
    expect(harness.session.events.some(event => event.type === 'autoReview/state')).toBe(false)
    const status = invoke(harness.commands.registered[0], harness, 'status')
    expect((status as { text: string }).text).toContain('Auto-review is OFF')
    // The in-memory override gates the answerer: nothing is reviewed, the chain delegates.
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

  it('trips the rejection circuit breaker in memory and rejects with marker-free text', async () => {
    const harness = await mountHarness(
      {
        toolsPolicy: { overrides: { bash: 'ai' } },
        circuitBreaker: { consecutiveDenies: 2, windowDenies: 10, windowSize: 50, action: 'reject' },
      },
      denyScript,
    )
    await dispatchAskedApproval(harness.ctx, harness.session, { agent: harness.agent, toolName: 'bash' }, next)
    await dispatchAskedApproval(harness.ctx, harness.session, { agent: harness.agent, toolName: 'bash' }, next)
    expect(harness.session.events.some(event => event.type === 'autoReview/circuit')).toBe(false)
    const callId = CallId('call-circuit-memory')
    const third = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
    }, next)
    expect(third.outcome).toBe('rejected')
    expect(harness.subagents.starts).toHaveLength(2)
    const decision = await dispatchPostExecute(harness.ctx, { callId } as never, {
      isError: true,
      content: [{ type: 'text', text: 'Error: rejected' }],
    }, async () => ({ kind: 'accept' }))
    const feedback = (decision as { feedback: { text: string }[] }).feedback
    expect(feedback[0]!.text).toContain('rejection circuit breaker rejected tool "bash"')
    expect(feedback[0]!.text).not.toMatch(/\[auto-review-circuit/u)
  })

  it('serves /auto-review approve from the in-memory denial feed', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } }, denyScript)
    await dispatchAskedApproval(harness.ctx, harness.session, { agent: harness.agent, toolName: 'bash' }, next)
    const approve = invoke(harness.commands.registered[0], harness, 'approve')
    expect(approve).toMatchObject({ kind: 'success' })
    expect((approve as { text: string }).text).toContain('Authorized ONE retry')
    expect(harness.session.events.some(event => event.type === 'autoReview/override')).toBe(false)
    // The next same-tool review carries the override as reviewer context.
    const second = await dispatchAskedApproval(harness.ctx, harness.session, { agent: harness.agent, toolName: 'bash' }, next)
    expect(second.outcome).toBe('rejected')
    const overrideStart = harness.subagents.starts.at(-1)!
    const overrideText = overrideStart.request.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(overrideText).toContain('HUMAN OVERRIDE')
  })
})

describe('append probe for unversioned hosts', () => {
  it('probes the first appended envelope and degrades when the marker is dropped', async () => {
    const { peerSessionVersion } = await import('../src/audit.ts')
    vi.mocked(peerSessionVersion).mockReturnValue(null)
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } }, denyScript)
    await dispatchAskedApproval(harness.ctx, harness.session, { agent: harness.agent, toolName: 'bash' }, next)
    // The first (probe) append lands unmarked on this rc.6 session…
    const firstCount = harness.session.events.filter(event => event.type === 'autoReview/verdict').length
    expect(firstCount).toBe(1)
    // …the probe then flips the runtime to unsupported: later verdicts stay out of the log.
    await dispatchAskedApproval(harness.ctx, harness.session, { agent: harness.agent, toolName: 'bash' }, next)
    expect(harness.session.events.filter(event => event.type === 'autoReview/verdict')).toHaveLength(1)
    vi.mocked(peerSessionVersion).mockReset()
  })
})
