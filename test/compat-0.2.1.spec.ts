/**
 * dsh 0.2.1 compatibility: the two seams the host moved underneath this plugin.
 *
 * 1. `approval/request` is a waterfall resolved in REGISTRATION order, and the
 *    web bundle mounts its forwarding answerer (`@deepseek-ai/dsh-api-remotes`)
 *    before any profile plugin. An answerer that registers later is never
 *    asked, so auto-review is bypassed silently — no error, no warning, the
 *    human dialog simply appears. The fix is positional (`prepend: true`), and
 *    the ordering test below fails without it.
 * 2. `ctx.subagents.start` is gone (0.2.1 replaced it with `startActivation`,
 *    whose spawn provider no longer takes a `toolFilter`), so the reviewer must
 *    be able to judge without a child: one tool-less `ctx.llm.stream` call on
 *    the delegating turn's route.
 * @module dsh-auto-review/test/compat-0.2.1.spec
 */

import { Context } from '@deepseek-ai/cordis'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import {
  appendRequestHeader,
  dispatchAskedApproval,
  makeAgent,
  makeCommands,
  makeLlm,
  makeSubagents,
  mountHarness,
  type ScriptedReview,
} from './harness.ts'

/** The downstream human answerer every delegating path must reach. */
const next = (): Promise<string> => Promise.resolve('allowed-once')

/** A reviewer verdict script, shared by both seams. */
const allowVerdict = (): ScriptedReview => ({ verdict: { decision: 'allow', reason: 'looks safe' } })

describe('answerer position in the approval waterfall', () => {
  /**
   * Assemble the web composition's order by hand: the forwarding answerer is
   * mounted FIRST, exactly as the app bundle does, then the plugin.
   */
  async function mountBehindEarlierAnswerer() {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('web-order-session'))
    session.append('turn/start', { turn: 1 })
    appendRequestHeader(session, { provider: 'deepseek', model: 'deepseek-chat' })
    await ctx.plugin(ApprovalService)
    const subagents = makeSubagents(allowVerdict, undefined, { withStart: false })
    const llm = makeLlm(allowVerdict)
    ctx.provide('subagents', subagents as never)
    ctx.provide('llm', llm as never)
    ctx.provide('commands', makeCommands() as never)
    ctx.provide('tools', {})
    // The forwarder claims whatever it can resolve, without calling `next()`.
    // Its `rejected` answer stands in for "the dialog was shown to the human".
    let forwarded = 0
    ctx.on('approval/request', () => {
      forwarded += 1
      return Promise.resolve('rejected')
    })
    await ctx.plugin(plugin as unknown as import('@deepseek-ai/cordis').Plugin, {
      allowUnmarkedAudit: true,
      toolsPolicy: { overrides: { bash: 'ai' } },
    })
    return { ctx, session, llm, forwarder: () => forwarded }
  }

  it('claims before an answerer that was registered earlier', async () => {
    const mounted = await mountBehindEarlierAnswerer()
    const agent = makeAgent(mounted.session)
    const { outcome } = await dispatchAskedApproval(mounted.ctx, mounted.session, {
      agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    // The reviewer decided; the forwarder was never asked.
    expect(outcome).toBe('allowed-once')
    expect(mounted.forwarder()).toBe(0)
    expect(mounted.llm.calls).toHaveLength(1)
  })

  it('still delegates with next() when the policy says human', async () => {
    const mounted = await mountBehindEarlierAnswerer()
    const agent = makeAgent(mounted.session)
    const { outcome } = await dispatchAskedApproval(mounted.ctx, mounted.session, {
      agent,
      toolName: 'web_fetch',
      reason: 'not in the policy table',
    }, next)
    // The forwarder's answer, not the reviewer's: delegation reached the
    // listener that raises the human dialog.
    expect(outcome).toBe('rejected')
    expect(mounted.forwarder()).toBe(1)
    expect(mounted.llm.calls).toHaveLength(0)
  })
})

describe('tool-less reviewer on a host without subagents.start', () => {
  /** Mount the 0.2.1 shape: no one-shot child seam, `llm` only. */
  async function mountInline(script = allowVerdict, pluginConfig: Record<string, unknown> = {}) {
    const harness = await mountHarness(
      { allowUnmarkedAudit: true, toolsPolicy: { overrides: { bash: 'ai' } }, ...pluginConfig },
      script,
      {},
      undefined,
      'inline',
    )
    appendRequestHeader(harness.session, { provider: 'deepseek', model: 'deepseek-chat' })
    return harness
  }

  it('grants on an allow verdict from the tool-less call', async () => {
    const harness = await mountInline()
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('allowed-once')
    expect(harness.subagents.starts).toHaveLength(0)
    expect(harness.llm.calls).toHaveLength(1)
    expect(harness.llm.calls[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      temperature: 0,
    })
  })

  it('reads the verdict out of a fenced answer with surrounding prose', async () => {
    const harness = await mountInline(() => ({
      llmText: 'Sure — here is my decision:\n```json\n{"decision":"allow","reason":"read-only ls","riskLevel":"low"}\n```',
    }))
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('allowed-once')
  })

  it('honours reviewerModel over the session route', async () => {
    const harness = await mountInline(allowVerdict, { reviewerModel: 'deepseek-reasoner' })
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(harness.llm.calls[0]).toMatchObject({ model: 'deepseek-reasoner' })
  })

  it('asks the tool-less reviewer for a bare JSON answer, not for a tool call', async () => {
    const harness = await mountInline()
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    const messages = harness.llm.calls[0]?.messages ?? []
    const prompt = messages.map(message => JSON.stringify(message)).join('\n')
    // The call has no tools, so naming `structured_output` would ask for
    // something the model cannot do.
    expect(prompt).not.toMatch(/structured_output/u)
    expect(prompt).toMatch(/EXACTLY ONE JSON object/u)
    expect(harness.llm.calls[0]?.tools).toBeUndefined()
  })

  it('denies (fail closed) when the answer is not a verdict', async () => {
    const harness = await mountInline(() => ({ llmText: 'I cannot decide.' }))
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('rejected')
  })

  it('denies (fail closed) on a reviewer transport error', async () => {
    const harness = await mountInline(() => ({ llmFinish: 'error' }))
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('rejected')
  })

  it('denies (fail closed) when the session has no request header route', async () => {
    const harness = await mountHarness(
      { allowUnmarkedAudit: true, toolsPolicy: { overrides: { bash: 'ai' } } },
      allowVerdict,
      {},
      undefined,
      'inline',
    )
    // No appendRequestHeader() here: nothing to route the reviewer to.
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('rejected')
    expect(harness.llm.calls).toHaveLength(0)
  })
})
