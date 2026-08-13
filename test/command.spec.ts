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
    signal: new AbortController().signal,
  })
}

describe('/auto-review command', () => {
  it('registers the command with its usage hint', async () => {
    const harness = await mountHarness()
    expect(harness.commands.registered).toHaveLength(1)
    expect(harness.commands.registered[0]).toMatchObject({
      name: 'auto-review',
      input: { hint: 'on|off|status' },
    })
  })

  it('status reports the default when no override exists', async () => {
    const harness = await mountHarness()
    const result = invoke(harness.commands.registered[0], harness, 'status')
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toContain('Auto-review is ON for this session.')
  })

  it('switches off: durable state event + model-visible switch notice', async () => {
    const harness = await mountHarness()
    const result = invoke(harness.commands.registered[0], harness, 'off')
    expect(result).toMatchObject({ kind: 'success' })
    const state = harness.session.events.find(event => event.type === 'autoReview/state')
    expect(state?.data).toEqual({ enabled: false })
    expect(harness.injected).toHaveLength(1)
    expect(harness.injected[0]!.content[0]).toMatchObject({ type: 'text' })
    expect((harness.injected[0]!.content[0] as { text: string }).text).toContain('switched OFF')
    expect(effectiveAutoReviewState(harness.session.events)).toBe(false)
  })

  it('switches back on and reports the change idempotently', async () => {
    const harness = await mountHarness()
    invoke(harness.commands.registered[0], harness, 'off')
    const result = invoke(harness.commands.registered[0], harness, 'on')
    expect(result).toMatchObject({ kind: 'success' })
    expect(effectiveAutoReviewState(harness.session.events)).toBe(true)
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
    const harness = await mountHarness()
    invoke(harness.commands.registered[0], harness, 'off')
    const restored = Session.create(SessionId('restored'), harness.session.events)
    expect(effectiveAutoReviewState(restored.events)).toBe(false)
    // A fresh session created from the same durable events delegates too.
    const agent = makeAgent(restored)
    expect(agent.session.events.some(event => event.type === 'autoReview/state')).toBe(true)
  })
})
