/**
 * Runtime of `dsh-auto-review`: the `approval/request` answerer (claim when
 * the session and tool policy say `ai`, otherwise strictly `next()`), the
 * reviewer verdict handling with fail-closed fallback, the deny-reason
 * injection into the denied tool result, and the `/auto-review` session
 * command. Every registration is an effect (ctx.on / commands.register).
 * @module dsh-auto-review/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-subagent'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from './config.ts'
import type { Config, ResolvedConfig, ToolReviewPolicy } from './config.ts'
import {
  autoReviewsInOpenTurn,
  correlateApprovalId,
  denyResultText,
  effectiveAutoReviewState,
  type AutoReviewVerdictId,
  type StateAppend,
  type VerdictAppend,
} from './events.ts'
import { isReviewFailure, newVerdictId, runReview } from './review.ts'
import type { ReviewFailure } from './review.ts'

export const name = 'auto-review'
export const inject = ['approval', 'subagents', 'commands', 'tools']

/** How long an injected deny reason stays available for its tool result (bounded cleanup). */
const DENY_REASON_TTL_MS = 5 * 60_000

/** One recorded deny reason waiting for the denied call's tool result. */
interface DenyReasonEntry {
  readonly text: string
  readonly at: number
}

/** Closed-union backstop for the fallback-policy switch. */
function assertNever(value: never, label: string): never {
  throw new TypeError(`unknown ${label}: ${String(value)}`)
}

/**
 * Answerer policy resolution for one request: the first matching risk rule
 * (security invariants win over tool defaults), then the exact tool override,
 * then the table default.
 * @param config - the resolved config.
 * @param request - the pending approval request.
 * @returns the policy this request resolves to.
 */
function policyFor(config: ResolvedConfig, request: ApprovalRequest): ToolReviewPolicy {
  const reason = request.reason ?? ''
  for (const rule of config.riskRules) {
    if (rule.regex.test(reason)) return rule.policy
  }
  const override = config.toolsPolicy.overrides[request.toolName]
  if (override !== undefined) return override
  return config.toolsPolicy.default
}

/**
 * Answerer state and behavior. One instance per plugin mount; disposals are
 * owned by the ctx.on / commands.register effects in {@link apply}.
 */
export class AutoReviewRuntime {
  /** Live reviewer child sessions — their approval asks never re-enter AI review. */
  private readonly reviewerSessions = new Set<SessionId>()

  /** Deny reasons keyed by call id, consumed (and deleted) by the post-execute listener. */
  private readonly denyReasons = new Map<CallId, DenyReasonEntry>()

  constructor(
    private readonly ctx: Context,
    readonly config: ResolvedConfig,
  ) {}

  /**
   * The `approval/request` answerer. Claims a request ONLY when auto-review
   * is enabled for the session AND the policy for this tool/reason is `ai`
   * AND the per-turn budget remains; everything else delegates via `next()`
   * (or deterministically rejects for `never`). The reviewer's own asks are
   * always delegated (anti-recursion).
   * @param request - the pending decision.
   * @param next - the downstream answerer chain.
   * @returns the closed approval outcome.
   */
  answer(request: ApprovalRequest, next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome> {
    // Anti-recursion: a reviewer child's own approval asks go to the human chain.
    if (this.reviewerSessions.has(request.agent.id)) return next()
    const session = request.agent.session
    const enabled = effectiveAutoReviewState(session.events) ?? this.config.enableByDefault
    if (!enabled) return next()
    const policy = policyFor(this.config, request)
    if (policy === 'never') return Promise.resolve<ApprovalOutcome>('rejected')
    if (policy !== 'ai') return next()
    if (autoReviewsInOpenTurn(session.events) >= this.config.maxReviewsPerTurn) return next()
    const approvalId = correlateApprovalId(session.events, request.toolName, request.callId)
    if (approvalId === undefined) {
      // The audit chain cannot be completed (verdict → approval/asked); treat
      // as an internal unavailability, never as a grant.
      return this.finish(request, undefined, {
        fallback: 'unavailable',
        error: 'cannot correlate the pending approval/asked audit event',
      }, next)
    }
    return this.review(request, approvalId, next)
  }

  /**
   * Run the reviewer for one claimed request, register the child for
   * anti-recursion, and settle the answerer chain.
   * @param request - the pending decision.
   * @param approvalId - the correlated `approval/asked` id.
   * @param next - the downstream chain (used by the `delegate` fallback).
   * @returns the closed approval outcome.
   */
  private async review(
    request: ApprovalRequest,
    approvalId: ApprovalRequestId,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    const started = Date.now()
    const resolution = await runReview(this.ctx, this.config, request, this.reviewerSessions)
    const durationMs = Date.now() - started
    if (isReviewFailure(resolution)) {
      return this.finish(request, approvalId, resolution, next, durationMs)
    }
    const reviewId = newVerdictId()
    ;(request.agent.session.append as unknown as VerdictAppend)('autoReview/verdict', {
      reviewId,
      approvalId,
      toolName: request.toolName,
      ...request.callId !== undefined ? { callId: request.callId } : {},
      provider: this.config.reviewerProvider,
      ...resolution.model !== undefined ? { model: resolution.model } : {},
      ...resolution.reviewerSessionId !== undefined ? { reviewerSessionId: resolution.reviewerSessionId } : {},
      durationMs,
      decision: resolution.decision,
      reason: resolution.reason,
      ...resolution.riskLevel !== undefined ? { riskLevel: resolution.riskLevel } : {},
      outcome: resolution.decision === 'allow' ? 'allowed-once' : 'rejected',
    }, { ignorable: true })
    if (resolution.decision === 'deny') {
      this.recordDenyReason(request.callId, request.toolName, reviewId, resolution.reason)
      return 'rejected'
    }
    return 'allowed-once'
  }

  /**
   * Append the fallback verdict event and apply the configured fallback
   * policy. A user cancellation settles `cancelled` regardless of policy;
   * otherwise `rejected` (fail closed), `allow-readonly`, or `delegate`
   * (continue the chain) per config.
   */
  private finish(
    request: ApprovalRequest,
    approvalId: ApprovalRequestId | undefined,
    failure: ReviewFailure,
    next: () => Promise<ApprovalOutcome>,
    durationMs = 0,
  ): Promise<ApprovalOutcome> {
    const outcome = this.fallbackOutcome(failure)
    if (approvalId !== undefined) {
      ;(request.agent.session.append as unknown as VerdictAppend)('autoReview/verdict', {
        reviewId: newVerdictId(),
        approvalId,
        toolName: request.toolName,
        ...request.callId !== undefined ? { callId: request.callId } : {},
        provider: this.config.reviewerProvider,
        ...failure.model !== undefined ? { model: failure.model } : {},
        ...failure.reviewerSessionId !== undefined ? { reviewerSessionId: failure.reviewerSessionId } : {},
        durationMs,
        fallback: failure.fallback,
        error: failure.error,
        ...outcome !== undefined ? { outcome } : {},
      }, { ignorable: true })
      this.ctx.logger.warn(`auto-review fallback (${failure.fallback}) for ${request.toolName}: ${failure.error}`)
    }
    if (outcome === undefined) return next()
    return Promise.resolve(outcome)
  }

  /**
   * Map one reviewer failure to the approval outcome the answerer settles
   * with: `cancelled` when the user aborted the request; otherwise the
   * configured fallback policy.
   * @param failure - the review failure.
   * @returns the outcome, or undefined when the chain must continue.
   */
  private fallbackOutcome(failure: ReviewFailure): ApprovalOutcome | undefined {
    if (failure.fallback === 'cancelled') return 'cancelled'
    switch (this.config.fallbackPolicy) {
      case 'rejected': return 'rejected'
      case 'allow-readonly': return 'allowed-once'
      case 'delegate': return undefined
      default: return assertNever(this.config.fallbackPolicy, 'fallback policy')
    }
  }

  /**
   * Record a deny reason for the denied call's tool result. Consumed once by
   * the post-execute listener; entries expire after a bounded TTL so a result
   * path that never reaches post-execute cannot grow the map.
   */
  private recordDenyReason(
    callId: CallId | undefined,
    toolName: string,
    reviewId: AutoReviewVerdictId,
    reason: string,
  ): void {
    if (callId === undefined) return
    const now = Date.now()
    for (const [key, entry] of this.denyReasons) {
      if (now - entry.at > DENY_REASON_TTL_MS) this.denyReasons.delete(key)
    }
    this.denyReasons.set(callId, { text: denyResultText(reviewId, toolName, reason), at: now })
  }

  /**
   * The `tools/post-execute` listener: replace the generic rejection text of
   * a call THIS answerer denied with the reviewer's reason (the model-visible
   * content, reconstructable via the embedded reviewId marker). Any other
   * call delegates untouched.
   */
  injectDenyReason(
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> {
    const entry = this.denyReasons.get(exec.callId)
    if (entry === undefined) return next()
    this.denyReasons.delete(exec.callId)
    // Only the denial result exists for this call (the tool never executed);
    // a non-error result means the chain evolved past us — leave it alone.
    if (!result.isError) return next()
    return Promise.resolve<PostToolDecision>({
      kind: 'block',
      feedback: [{ type: 'text', text: entry.text }],
    })
  }

  /**
   * Execute the `/auto-review` command: `on` / `off` write the durable
   * `autoReview/state` override (surviving restore) and inject a switch
   * notice; `status` reports the effective state.
   * @param invocation - the received command invocation.
   * @returns the command result shown to the user.
   */
  command(invocation: CommandInvocation): CommandResult {
    const agent = invocation.agent
    const session = agent.session
    const input = invocation.rawInput.trim().toLowerCase()
    const current = effectiveAutoReviewState(session.events) ?? this.config.enableByDefault
    if (input === 'status' || input === '') {
      return {
        kind: 'success',
        text: [
          `Auto-review is ${current ? 'ON' : 'OFF'} for this session.`,
          `Verdicts this turn: ${autoReviewsInOpenTurn(session.events)}/${this.config.maxReviewsPerTurn}.`,
          'Usage: /auto-review on|off|status',
        ].join('\n'),
      }
    }
    if (input !== 'on' && input !== 'off') {
      return {
        kind: 'error',
        text: `Unknown /auto-review argument "${invocation.rawInput.trim()}". Usage: /auto-review on|off|status`,
      }
    }
    const enabled = input === 'on'
    if (current === enabled) {
      return { kind: 'success', text: `Auto-review is already ${input.toUpperCase()} for this session.` }
    }
    ;(session.append as unknown as StateAppend)('autoReview/state', { enabled }, { ignorable: true })
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `AI auto-review was switched ${enabled ? 'ON' : 'OFF'} for this session (changed by the user).`,
      }],
      source: { kind: 'plugin', plugin: 'auto-review' },
    }))
    return { kind: 'success', text: `Auto-review ${input.toUpperCase()} for this session.` }
  }
}

/**
 * Mount the plugin: resolve config, register the answerer and the
 * post-execute listener as effects, and register the slash command.
 * @param ctx - the host context.
 * @param config - raw plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const runtime = new AutoReviewRuntime(ctx, resolved)
  ctx.on('approval/request', (request, next) => runtime.answer(request, next))
  ctx.on('tools/post-execute', (exec, result, next) => runtime.injectDenyReason(exec, result, next))
  ctx.commands.register({
    name: 'auto-review',
    description: 'enable or disable second-model AI auto-review for this session',
    input: { hint: 'on|off|status' },
    handler: invocation => runtime.command(invocation),
  })
}
