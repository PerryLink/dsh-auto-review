/**
 * Fiber-disposal / HMR-safety suite: mounting the plugin over the REAL
 * commands runtime, disposing its contributing fiber, and re-querying the
 * authoritative registries to prove every contribution disappears — the
 * `/auto-review` command and the `approval/request` answerer alike. The
 * scripted `commands` mock used elsewhere never actually unregisters, so this
 * suite mounts the real `CommandRuntime` to observe the removal.
 * @module dsh-auto-review/test/lifecycle.spec
 */

import { Context } from '@deepseek-ai/cordis'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { dispatchApproval, makeAgent } from './harness.ts'

/** Mount the plugin over real session/approval/commands services and faked heavyweight injects. */
async function mountWithRealCommands() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('lifecycle-session'))
  await ctx.plugin(ApprovalService)
  await ctx.plugin(CommandRuntime)
  ctx.provide('subagents', {
    getProvider: () => undefined,
    start: async () => { throw new Error('no subagent provider') },
  })
  ctx.provide('tools', {})
  const injected: import('@deepseek-ai/dsh-llm').UserMessage[] = []
  const fiber = await ctx.plugin(plugin as unknown as import('@deepseek-ai/cordis').Plugin, {
    toolsPolicy: { default: 'never' },
  })
  const agent = makeAgent(session, injected)
  return { ctx, session, agent, fiber }
}

const downstream = (): Promise<string> => Promise.resolve('allowed-once')

describe('fiber disposal', () => {
  it('removes /auto-review and the answerer when the contributing fiber is disposed', async () => {
    const harness = await mountWithRealCommands()
    try {
      // Both contributions are present while the fiber lives.
      expect(harness.ctx.commands.list(harness.agent).find(entry => entry.name === 'auto-review')).toBeDefined()
      const before = await dispatchApproval(harness.ctx, {
        agent: harness.agent,
        toolName: 'bash',
        reason: 'loader smoke',
      }, downstream)
      expect(before).toBe('rejected')

      await harness.fiber.dispose()

      // The command leaves the registry and the answerer no longer claims asks.
      expect(harness.ctx.commands.list(harness.agent).find(entry => entry.name === 'auto-review')).toBeUndefined()
      const after = await dispatchApproval(harness.ctx, {
        agent: harness.agent,
        toolName: 'bash',
        reason: 'loader smoke',
      }, downstream)
      expect(after).toBe('allowed-once')
    } finally {
      await harness.ctx.fiber.dispose()
    }
  })
})
