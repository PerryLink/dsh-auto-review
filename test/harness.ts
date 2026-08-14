/**
 * Shared test harness: real Cordis Context + real Session/ApprovalService,
 * scripted subagent/commands/tools mocks, and a minimal fake Agent.
 * @module dsh-auto-review/test/harness
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentRun, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ReviewerVerdict } from '../src/review.ts'

/** Scripted reviewer behavior for the mock subagent provider. */
export interface ScriptedReview {
  /** The structured verdict to return; absent means no structured capture. */
  readonly verdict?: ReviewerVerdict
  /** Terminal stop reason (default `completed`). */
  readonly stopReason?: string
  /** Reject the start call with this error (subagent seam failure). */
  readonly failStart?: Error
  /** Delay before the run settles (for timeout tests). */
  readonly delayMs?: number
  /** Delay before `start` resolves; the start call itself rejects when the run signal was aborted meanwhile and {@link failStartOnAbort} is set. */
  readonly startDelayMs?: number
  /** Reject `start` when its signal is already aborted (pre-publication abort). */
  readonly failStartOnAbort?: boolean
  /** Reject the run result with an AbortError when the run signal aborts (abort surfaced as a rejection). */
  readonly rejectOnAbort?: boolean
}

/** Mock `ctx.subagents` service recording every start request. */
export interface MockSubagents {
  getProvider(name: string): object | undefined
  start(name: string, request: SubagentStartRequest): Promise<SubagentRun>
  readonly starts: { name: string; request: SubagentStartRequest }[]
}

/** Mock `ctx.commands` service capturing registrations. */
export interface MockCommands {
  register(definition: CommandDefinition): () => void
  readonly registered: CommandDefinition[]
}

/**
 * A structurally complete fake agent: real session, real context, recorded
 * injected messages; everything driver-shaped is a no-op.
 * @param session - the agent's session.
 * @param injected - array receiving `agent.inject()` messages.
 * @returns the fake agent.
 */
export function makeAgent(session: Session, injected: UserMessage[] = []): Agent {
  const fake = {
    id: session.id,
    options: {},
    session,
    inbox: {},
    status: 'idle',
    ctx: new Context(),
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (task: (signal: AbortSignal) => Promise<unknown>) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: (message: UserMessage) => {
      injected.push(message)
    },
  }
  return fake as unknown as Agent
}

/** Build the scripted subagent service. */
export function makeSubagents(script: () => ScriptedReview, capabilities?: object): MockSubagents {
  const starts: { name: string; request: SubagentStartRequest }[] = []
  return {
    getProvider(name: string): object | undefined {
      return name === 'mock' ? (capabilities ?? {}) : undefined
    },
    async start(name: string, request: SubagentStartRequest): Promise<SubagentRun> {
      const behavior = script()
      starts.push({ name, request })
      if (behavior.failStart !== undefined) throw behavior.failStart
      const started = (async () => {
        if (behavior.startDelayMs !== undefined) {
          await new Promise<void>(resolve => setTimeout(resolve, behavior.startDelayMs))
        }
        if (behavior.failStartOnAbort === true && request.signal.aborted) {
          throw new Error('aborted before publication')
        }
      })()
      await started
      const result = (async () => {
        if (behavior.rejectOnAbort === true) {
          await new Promise<never>((_, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')), { once: true })
          })
        }
        if (behavior.delayMs !== undefined) {
          await new Promise<void>(resolve => setTimeout(resolve, behavior.delayMs))
        }
        return behavior.verdict !== undefined
          ? { output: [], structured: behavior.verdict, stopReason: 'completed' }
          : { output: [], structured: undefined, stopReason: behavior.stopReason ?? 'completed' }
      })()
      return {
        id: SessionId('reviewer-session'),
        localAgent: undefined,
        result: result as SubagentRun['result'],
        dispose: async () => undefined,
      }
    },
    starts,
  }
}

/** Build the capturing commands service. */
export function makeCommands(): MockCommands {
  const registered: CommandDefinition[] = []
  return {
    register(definition: CommandDefinition): () => void {
      registered.push(definition)
      return () => undefined
    },
    registered,
  }
}

/** Everything a mounted harness hands back to a test. */
export interface Harness {
  readonly ctx: Context
  readonly session: Session
  readonly agent: Agent
  readonly injected: UserMessage[]
  readonly subagents: MockSubagents
  readonly commands: MockCommands
}

/** Mount our plugin with real approval service, real session, scripted reviewer. */
export async function mountHarness(
  pluginConfig: Record<string, unknown> = {},
  script: () => ScriptedReview = () => ({ verdict: { decision: 'allow', reason: 'looks safe' } }),
  approvalConfig: Record<string, unknown> = {},
  providerCapabilities?: object,
): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId('harness-session'))
  session.append('turn/start', { turn: 1 })
  await ctx.plugin(ApprovalService, approvalConfig)
  const subagents = makeSubagents(script, providerCapabilities)
  const commands = makeCommands()
  ctx.provide('subagents', subagents as never)
  ctx.provide('commands', commands as never)
  ctx.provide('tools', {})
  const plugin = await import('../src/index.ts')
  await ctx.plugin(plugin as unknown as import('@deepseek-ai/cordis').Plugin, {
    reviewerProvider: 'mock',
    ...pluginConfig,
  })
  const injected: UserMessage[] = []
  const agent = makeAgent(session, injected)
  return { ctx, session, agent, injected, subagents, commands }
}

/** Dispatch the `approval/request` waterfall with a downstream answerer. */
export async function dispatchApproval(
  ctx: Context,
  request: Parameters<ApprovalService['request']>[0],
  downstream: () => Promise<string>,
): Promise<string> {
  return (ctx.waterfall as unknown as (
    name: string,
    input: Parameters<ApprovalService['request']>[0],
    init: () => Promise<string>,
  ) => Promise<string>)('approval/request', request, downstream)
}

/**
 * Append the `approval/asked` event (what the real service does before
 * dispatch), then dispatch the waterfall. Returns the asked id so tests can
 * assert the audit chain.
 */
export async function dispatchAskedApproval(
  ctx: Context,
  session: Session,
  request: Parameters<ApprovalService['request']>[0],
  downstream: () => Promise<string>,
): Promise<{ outcome: string; askedId: string }> {
  const askedId = `asked-${Math.random().toString(36).slice(2)}`
  session.append('approval/asked', {
    id: askedId as never,
    toolName: request.toolName,
    ...request.callId !== undefined ? { callId: request.callId } : {},
    ...request.reason !== undefined ? { reason: request.reason } : {},
  })
  const outcome = await dispatchApproval(ctx, request, downstream)
  return { outcome, askedId }
}

/** Dispatch the `tools/post-execute` waterfall with a downstream decision. */
export async function dispatchPostExecute(
  ctx: Context,
  exec: unknown,
  result: unknown,
  downstream: () => Promise<unknown>,
): Promise<unknown> {
  return (ctx.waterfall as unknown as (
    name: string,
    execution: unknown,
    toolResult: unknown,
    init: () => Promise<unknown>,
  ) => Promise<unknown>)('tools/post-execute', exec, result, downstream)
}
