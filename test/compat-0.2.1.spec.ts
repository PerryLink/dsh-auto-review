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
 *    whose spawn provider no longer takes a `toolFilter`). An activation host
 *    is usable only with a read-only `reviewerPreset`; without one the reviewer
 *    falls back to a tool-less `ctx.llm.stream` call on the delegating turn's
 *    route, and a host with neither seam nor `llm` resolves `unavailable`.
 * @module dsh-auto-review/test/compat-0.2.1.spec
 */

import { Context } from '@deepseek-ai/cordis'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { VERDICT_SCHEMA } from '../src/index.ts'
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
    // rc.3's ApprovalService injects `sessionProjections`; without the
    // registry its fiber never activates, so the plugin waits on `approval`.
    await ctx.plugin(SessionProjectionRegistry)
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

describe('reviewer seam dispatch on an activation host', () => {
  /**
   * Mount the 0.2.1+ shape: `startActivation` only. The plugin config decides
   * whether the preset-composed child is available this time.
   */
  async function mountActivation(pluginConfig: Record<string, unknown> = {}) {
    const harness = await mountHarness(
      { allowUnmarkedAudit: true, toolsPolicy: { overrides: { bash: 'ai' } }, ...pluginConfig },
      allowVerdict,
      {},
      undefined,
      'activation',
    )
    appendRequestHeader(harness.session, { provider: 'deepseek', model: 'deepseek-chat' })
    return harness
  }

  it('routes to startActivation when reviewerPreset is configured, with flat request fields', async () => {
    const harness = await mountActivation({ reviewerPreset: 'read-only-reviewer' })
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('allowed-once')
    // The activation seam, not the legacy child nor the tool-less call.
    expect(harness.subagents.starts).toHaveLength(0)
    expect(harness.subagents.activations).toHaveLength(1)
    expect(harness.llm.calls).toHaveLength(0)
    const { spec } = harness.subagents.activations[0]!
    expect(spec.provider).toBe('mock')
    expect(spec.delivery).toBe('caller')
    // The rc.3 host reads the task fields at the TOP level; a nested-only spec
    // would silently start with no prompt at all.
    expect(spec.agentPreset).toBe('read-only-reviewer')
    expect(spec.outputSchema).toEqual(VERDICT_SCHEMA)
    expect(spec.maxDepth).toBe(1)
    expect(spec.prompt).toBeDefined()
    const text = (spec.prompt ?? []).map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('Tool name: bash')
    // The rc.1 alias carries the same composition under `request`.
    expect(spec.request.agentPreset).toBe('read-only-reviewer')
    expect(spec.request.prompt).toEqual(spec.prompt)
  })

  it('falls back to the tool-less call when no reviewerPreset is configured', async () => {
    const harness = await mountActivation()
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('allowed-once')
    // Without a read-only preset the activation child would inherit the
    // parent's tools, so the reviewer must not start one at all.
    expect(harness.subagents.activations).toHaveLength(0)
    expect(harness.subagents.starts).toHaveLength(0)
    expect(harness.llm.calls).toHaveLength(1)
  })
})

describe('reviewer with neither subagent seam nor llm', () => {
  it('resolves unavailable (fail closed) instead of throwing', async () => {
    const harness = await mountHarness(
      { allowUnmarkedAudit: true, toolsPolicy: { overrides: { bash: 'ai' } } },
      allowVerdict,
      {},
      undefined,
      'inline-no-llm',
    )
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('rejected')
    const verdict = harness.session.snapshotEvents().find(event => event.type === 'autoReview/verdict')
    expect(verdict?.data).toMatchObject({ fallback: 'unavailable' })
    expect((verdict?.data as { error?: string }).error).toContain('neither')
    expect(harness.llm.calls).toHaveLength(0)
  })
})

describe('tool-less reviewer on a host without a child seam', () => {
  /** Mount the seam-less shape: neither `start` nor `startActivation`, `llm` only. */
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
    expect(harness.subagents.activations).toHaveLength(0)
    expect(harness.llm.calls).toHaveLength(1)
    expect(harness.llm.calls[0]).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
    // Thinking mode ignores temperature silently; the request must not claim
    // a control the model never applies.
    expect(harness.llm.calls[0]).not.toHaveProperty('temperature')
    // Unset effort inherits the host/model default: nothing is sent.
    expect(harness.llm.calls[0]?.reasoningEffort).toBeUndefined()
  })

  it('forwards reviewerReasoningEffort to the tool-less call when configured', async () => {
    const harness = await mountInline(allowVerdict, { reviewerReasoningEffort: 'low' })
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(outcome).toBe('allowed-once')
    expect(harness.llm.calls[0]?.reasoningEffort).toBe('low')
    expect(harness.llm.calls[0]).not.toHaveProperty('temperature')
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

  it('honours reviewerModelProvider over the session provider', async () => {
    const harness = await mountInline(allowVerdict, { reviewerModel: 'other-model', reviewerModelProvider: 'other-provider' })
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      reason: 'escalate sandbox',
    }, next)
    expect(harness.llm.calls[0]).toMatchObject({ provider: 'other-provider', model: 'other-model' })
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
