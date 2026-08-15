/**
 * Runtime of `dsh-auto-review`: the `approval/request` answerer (claim when
 * the session and tool policy say `ai`, otherwise strictly `next()`), the
 * reviewer verdict handling with fail-closed fallback, the risk-policy
 * escalation, the rejection circuit breaker, the deny-reason injection into
 * the denied tool result, and the `/auto-review` session command. Every
 * registration is an effect (ctx.on / commands.register).
 * @module dsh-auto-review/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-subagent'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { resolveConfig, riskExceeds } from './config.ts'
import type { Config, ResolvedConfig, ToolReviewPolicy } from './config.ts'
import { messages } from './messages.ts'
import { makeAutoReviewProjection } from './projection.ts'
import {
  activeOverride,
  autoReviewFailuresInOpenTurn,
  autoReviewsInOpenTurn,
  circuitInOpenTurn,
  circuitResultText,
  consecutiveDeniesInOpenTurn,
  correlateApprovalId,
  deniesInRecentVerdicts,
  denyResultText,
  effectiveAutoReviewState,
  fallbackResultText,
  lastDeniedVerdicts,
  neverResultText,
  reviewStats,
  type AutoReviewFallback,
  type AutoReviewVerdictId,
  type CircuitAppend,
  type OverrideAppend,
  type RejectionAppend,
  type StateAppend,
  type VerdictAppend,
} from './events.ts'
import { isReviewFailure, newCircuitId, newRejectionId, newVerdictId, runReview, sanitizedArgumentsText, truncate } from './review.ts'
import type { OverrideContext, ReviewFailure } from './review.ts'

export const name = 'auto-review'
export const inject = ['approval', 'subagents', 'commands', 'tools']

/** How long an injected feedback text stays available for its tool result (bounded cleanup). */
const FEEDBACK_TTL_MS = 5 * 60_000

/** One recorded feedback text waiting for the denied/failed call's tool result. */
interface FeedbackEntry {
  readonly text: string
  readonly at: number
}

/** Closed-union backstop for the fallback-policy switch. */
function assertNever(value: never, label: string): never {
  throw new TypeError(`unknown ${label}: ${String(value)}`)
}

/** One policy resolution: the policy plus which rule or table entry produced it. */
interface ResolvedPolicy {
  readonly policy: ToolReviewPolicy
  /** The matched risk rule or policy table entry, for prompts and the never-rejection audit. */
  readonly source: string
}

/**
 * Answerer policy resolution for one request: the first matching risk rule
 * (security invariants win over tool defaults), then the exact tool override,
 * then the table default. Each rule matches its configured field: the
 * request reason, the tool name, or the redacted presented call arguments.
 * @param config - the resolved config.
 * @param request - the pending approval request.
 * @param argumentsText - the sanitized call-arguments JSON, when the log has it.
 * @returns the policy this request resolves to, with its provenance.
 */
function policyFor(config: ResolvedConfig, request: ApprovalRequest, argumentsText: string | undefined): ResolvedPolicy {
  for (const rule of config.riskRules) {
    const subject = rule.field === 'reason'
      ? request.reason ?? ''
      : rule.field === 'toolName'
        ? request.toolName
        : argumentsText ?? ''
    if (rule.regex.test(subject)) return { policy: rule.policy, source: `risk rule /${rule.pattern}/ (${rule.field})` }
  }
  const override = config.toolsPolicy.overrides[request.toolName]
  if (override !== undefined) return { policy: override, source: `toolsPolicy.overrides.${request.toolName}` }
  return { policy: config.toolsPolicy.default, source: 'toolsPolicy.default' }
}

/**
 * Answerer state and behavior. One instance per plugin mount; disposals are
 * owned by the ctx.on / commands.register effects in {@link apply}.
 */
export class AutoReviewRuntime {
  /** Live reviewer child sessions — their approval asks never re-enter AI review. */
  private readonly reviewerSessions = new Set<SessionId>()

  /** Feedback texts keyed by call id, consumed (and deleted) by the post-execute listener. */
  private readonly feedback = new Map<CallId, FeedbackEntry>()

  constructor(
    private readonly ctx: Context,
    readonly config: ResolvedConfig,
  ) {}

  /**
   * The `approval/request` answerer. Claims a request ONLY when auto-review
   * is enabled for the session AND the policy for this tool/reason is `ai`
   * AND both per-turn budgets remain AND the rejection circuit breaker is
   * not tripped; everything else delegates via `next()` (or deterministically
   * rejects for `never`). The reviewer's own asks are always delegated
   * (anti-recursion).
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
    const needsArguments = this.config.riskRules.some(rule => rule.field === 'arguments')
    const argumentsText = needsArguments && request.callId !== undefined
      ? sanitizedArgumentsText(session.events, request.callId)
      : undefined
    const { policy, source } = policyFor(this.config, request, argumentsText)
    if (policy === 'never') return this.neverReject(request, source)
    if (policy !== 'ai') return next()
    // Separate budgets: real AI verdicts vs reviewer failures. A broken
    // reviewer burns the failure budget (then delegates) without eating the
    // AI-decision budget, and vice versa.
    if (autoReviewsInOpenTurn(session.events) >= this.config.maxReviewsPerTurn) return next()
    if (autoReviewFailuresInOpenTurn(session.events) >= this.config.maxFailuresPerTurn) return next()
    const circuit = circuitInOpenTurn(session.events)
    if (circuit !== undefined) return this.circuitSettle(request, circuit, next)
    const approvalId = correlateApprovalId(session.events, request.toolName, request.callId)
    if (approvalId === undefined) {
      // The audit chain cannot be completed (verdict → approval/asked); treat
      // as an internal unavailability, never as a grant.
      return this.finish(request, undefined, {
        fallback: 'unavailable',
        error: 'cannot correlate the pending approval/asked audit event',
      }, next)
    }
    const overrideId = activeOverride(session.events, request.toolName, this.config.overrideTtlMs, Date.now())
    const override: OverrideContext | undefined = overrideId === undefined
      ? undefined
      : { reviewId: overrideId, toolName: request.toolName }
    return this.review(request, approvalId, next, override)
  }

  /**
   * Settle a `never`-policy request deterministically: record the log-only
   * `autoReview/rejection` audit event, and feed a model-visible
   * `[auto-review-never]` marker text (plus the deny guidance) into the
   * denied call's tool result — without it the model only sees the generic
   * rejection and keeps retrying a hard-disabled action. No reviewer runs
   * and no budget is consumed.
   * @param request - the hard-disabled decision.
   * @param source - the matched risk rule or policy table entry.
   * @returns the closed rejection.
   */
  private neverReject(request: ApprovalRequest, source: string): Promise<ApprovalOutcome> {
    const rejectionId = newRejectionId()
    const reason = truncate(source, this.config.reasonMaxChars)
    const approvalId = correlateApprovalId(request.agent.session.events, request.toolName, request.callId)
    ;(request.agent.session.append as unknown as RejectionAppend)('autoReview/rejection', {
      rejectionId,
      ...approvalId !== undefined ? { approvalId } : {},
      toolName: request.toolName,
      ...request.callId !== undefined ? { callId: request.callId } : {},
      reason,
      outcome: 'rejected',
    }, { ignorable: true })
    this.recordFeedback(request.callId, `${neverResultText(rejectionId, request.toolName, reason)}\n${this.config.denyGuidance}`)
    return Promise.resolve<ApprovalOutcome>('rejected')
  }

  /**
   * Run the reviewer for one claimed request, register the child for
   * anti-recursion, apply the risk policy, record the verdict, trip the
   * circuit breaker on denials, and settle the answerer chain.
   * @param request - the pending decision.
   * @param approvalId - the correlated `approval/asked` id.
   * @param next - the downstream chain (used by risk-policy delegation).
   * @param override - a pending human one-shot override, when one applies.
   * @returns the closed approval outcome.
   */
  private async review(
    request: ApprovalRequest,
    approvalId: ApprovalRequestId,
    next: () => Promise<ApprovalOutcome>,
    override?: OverrideContext,
  ): Promise<ApprovalOutcome> {
    const started = Date.now()
    const resolution = await runReview(this.ctx, this.config, request, this.reviewerSessions, override)
    const durationMs = Date.now() - started
    if (isReviewFailure(resolution)) {
      return this.finish(request, approvalId, resolution, next, durationMs)
    }
    const reviewId = newVerdictId()
    const overridden = resolution.decision === 'allow'
      && resolution.riskLevel !== undefined
      && riskExceeds(resolution.riskLevel, this.config.riskPolicy.maxAutoAllow)
    const outcome: ApprovalOutcome | undefined = overridden
      ? this.config.riskPolicy.onHighRisk === 'deny' ? 'rejected' : undefined
      : resolution.decision === 'allow' ? 'allowed-once' : 'rejected'
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
      ...overridden ? { escalation: 'risk-policy' } : {},
      ...outcome !== undefined ? { outcome } : {},
    }, { ignorable: true })
    if (outcome === undefined) return next()
    if (resolution.decision === 'deny') {
      this.recordDenyReason(request.callId, request.toolName, reviewId, resolution.reason)
      this.checkCircuit(request)
      return 'rejected'
    }
    if (overridden) {
      // The reviewer allowed, but the risk policy denied: feed the override
      // back to the model and count it toward the rejection circuit breaker.
      this.recordDenyReason(
        request.callId,
        request.toolName,
        reviewId,
        `${resolution.reason} (risk ${resolution.riskLevel} exceeds the configured maxAutoAllow ${this.config.riskPolicy.maxAutoAllow}; the allow verdict was overridden)`,
      )
      this.checkCircuit(request)
      return 'rejected'
    }
    return 'allowed-once'
  }

  /**
   * Append the fallback verdict event and apply the configured fallback
   * policy. A user cancellation settles `cancelled` regardless of policy;
   * otherwise `rejected` (fail closed), `allow-once`, or `delegate`
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
      const reviewId = newVerdictId()
      ;(request.agent.session.append as unknown as VerdictAppend)('autoReview/verdict', {
        reviewId,
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
      // A fail-closed rejection is as model-visible as a reviewer deny: the
      // agent learns WHY it was rejected (and that the reviewer failed)
      // instead of retrying the same escalation blindly.
      if (outcome === 'rejected') {
        this.recordFallbackFeedback(request.callId, reviewId, failure.fallback, failure.error)
      }
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
      case 'allow-once': return 'allowed-once'
      case 'delegate': return undefined
      default: return assertNever(this.config.fallbackPolicy, 'fallback policy')
    }
  }

  /**
   * Settle one request while the rejection circuit breaker is tripped:
   * `delegate` continues the chain; `reject` (and `abort-turn`, whose abort
   * already happened at trip time) rejects with an auditable marker.
   * @param request - the pending decision.
   * @param circuit - the turn's recorded circuit trip.
   * @param next - the downstream chain.
   * @returns the closed approval outcome.
   */
  private circuitSettle(
    request: ApprovalRequest,
    circuit: SessionEventMap['autoReview/circuit'],
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    if (circuit.action === 'delegate') return next()
    const explanation = `rejection circuit breaker tripped (${circuit.trip.kind}: ${circuit.trip.count} denials)`
    this.recordFeedback(request.callId, circuitResultText(circuit.circuitId, request.toolName, explanation))
    return Promise.resolve<ApprovalOutcome>('rejected')
  }

  /**
   * Trip the rejection circuit breaker after a denial, at most once per
   * turn. `abort-turn` also injects a model-visible warning and cancels the
   * agent (deferred a macrotask so the service's `approval/decided` append
   * commits first — the pair must stay turn-enclosed).
   * @param request - the request whose denial may trip the breaker.
   */
  private checkCircuit(request: ApprovalRequest): void {
    const session = request.agent.session
    if (circuitInOpenTurn(session.events) !== undefined) return
    const { consecutiveDenies, windowDenies, windowSize, action } = this.config.circuitBreaker
    const consecutive = consecutiveDeniesInOpenTurn(session.events)
    const trip = consecutive >= consecutiveDenies
      ? { kind: 'consecutive' as const, count: consecutive }
      : (() => {
        const window = deniesInRecentVerdicts(session.events, windowSize)
        return window >= windowDenies ? { kind: 'window' as const, count: window } : undefined
      })()
    if (trip === undefined) return
    const circuitId = newCircuitId()
    ;(session.append as unknown as CircuitAppend)('autoReview/circuit', {
      circuitId,
      action,
      trip,
      toolName: request.toolName,
    }, { ignorable: true })
    this.ctx.logger.warn(`auto-review circuit breaker tripped (${trip.kind}: ${trip.count}) by ${request.toolName}; action=${action}`)
    if (action === 'abort-turn') {
      request.agent.inject(createUserMessage({
        content: [{ type: 'text', text: messages(this.config.language).circuitNotice(trip.kind, trip.count) }],
        source: { kind: 'plugin', plugin: 'auto-review' },
      }))
      setTimeout(() => {
        request.agent.cancel({ kind: 'hook', reason: `auto-review circuit breaker: ${trip.kind} ${trip.count}` })
      }, 0)
    }
  }

  /**
   * Store one model-visible feedback text for a denied/failed call's tool
   * result, keyed by call id. Consumed once by the post-execute listener;
   * entries expire after a bounded TTL so a result path that never reaches
   * post-execute cannot grow the map. Same call id twice is last-wins (a
   * retried approval replaces its own pending feedback).
   */
  private recordFeedback(callId: CallId | undefined, text: string): void {
    if (callId === undefined) return
    const now = Date.now()
    for (const [key, entry] of this.feedback) {
      if (now - entry.at > FEEDBACK_TTL_MS) this.feedback.delete(key)
    }
    this.feedback.set(callId, { text, at: now })
  }

  /**
   * Record a deny reason (plus the anti-circumvention guidance) for the
   * denied call's tool result.
   * @param callId - the denied call.
   * @param toolName - the denied tool.
   * @param reviewId - the verdict event's id (embedded in the injected text).
   * @param reason - the reviewer's reason.
   */
  private recordDenyReason(
    callId: CallId | undefined,
    toolName: string,
    reviewId: AutoReviewVerdictId,
    reason: string,
  ): void {
    this.recordFeedback(callId, `${denyResultText(reviewId, toolName, reason)}\n${this.config.denyGuidance}`)
  }

  /**
   * Record a fallback-rejection text for the failed call's tool result.
   * @param callId - the failed call.
   * @param reviewId - the fallback verdict event's id (embedded in the text).
   * @param fallback - the failure category.
   * @param error - the failure detail.
   */
  private recordFallbackFeedback(
    callId: CallId | undefined,
    reviewId: AutoReviewVerdictId,
    fallback: AutoReviewFallback,
    error: string,
  ): void {
    this.recordFeedback(callId, fallbackResultText(reviewId, fallback, truncate(error, this.config.reasonMaxChars)))
  }

  /**
   * The `tools/post-execute` listener: replace the generic rejection text of
   * a call THIS answerer denied with the recorded feedback (the model-visible
   * content, reconstructable via the embedded marker). Any other call
   * delegates untouched.
   */
  injectDenyReason(
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> {
    const entry = this.feedback.get(exec.callId)
    if (entry === undefined) return next()
    this.feedback.delete(exec.callId)
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
   * notice; `status` reports the effective state, both per-turn budgets,
   * and the session's cumulative statistics; `approve [n]` records a
   * one-shot human override for a recent denial.
   * @param invocation - the received command invocation.
   * @returns the command result shown to the user.
   */
  command(invocation: CommandInvocation): CommandResult {
    const agent = invocation.agent
    const session = agent.session
    const t = messages(this.config.language)
    const input = invocation.rawInput.trim().toLowerCase()
    if (input.startsWith('approve')) return this.approveCommand(invocation)
    const current = effectiveAutoReviewState(session.events) ?? this.config.enableByDefault
    if (input === 'status' || input === '') {
      const stats = reviewStats(session.events)
      const circuit = circuitInOpenTurn(session.events)
      const recent = stats.recent.length === 0
        ? []
        : [t.recentLine(stats.recent.map(verdict => {
          const label = verdict.decision !== undefined
            ? verdict.decision
            : `fallback(${verdict.fallback ?? '?'})`
          return `${verdict.toolName}: ${label}`
        }).join(', '))]
      return {
        kind: 'success',
        text: [
          t.statusLine(current),
          t.verdictsLine(autoReviewsInOpenTurn(session.events), this.config.maxReviewsPerTurn),
          t.failuresLine(autoReviewFailuresInOpenTurn(session.events), this.config.maxFailuresPerTurn),
          ...circuit === undefined ? [] : [t.circuitLine(circuit.trip.kind, circuit.trip.count, circuit.action)],
          t.allTimeLine(stats.allows, stats.denies, stats.fallbacks, stats.rejections, stats.avgDurationMs),
          ...recent,
          t.usage,
        ].join('\n'),
      }
    }
    if (input !== 'on' && input !== 'off') {
      return {
        kind: 'error',
        text: t.unknownArg(invocation.rawInput.trim()),
      }
    }
    const enabled = input === 'on'
    if (current === enabled) {
      return { kind: 'success', text: t.already(input.toUpperCase()) }
    }
    ;(session.append as unknown as StateAppend)('autoReview/state', { enabled }, { ignorable: true })
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: t.switchedNotice(enabled),
      }],
      source: { kind: 'plugin', plugin: 'auto-review' },
    }))
    return { kind: 'success', text: t.switchedResult(input.toUpperCase()) }
  }

  /**
   * Execute `/auto-review approve [n]`: record a single-use human override
   * for the n-th most recent denial (1 = most recent). The override is
   * consumed by the NEXT same-tool review within `overrideTtlMs`, which
   * carries the authorization as reviewer context — the reviewer still
   * decides.
   * @param invocation - the received command invocation.
   * @returns the command result shown to the user.
   */
  private approveCommand(invocation: CommandInvocation): CommandResult {
    const agent = invocation.agent
    const session = agent.session
    const t = messages(this.config.language)
    const arg = invocation.rawInput.trim().split(/\s+/u)[1]
    const index = arg === undefined ? 1 : Number.parseInt(arg, 10)
    if (!Number.isSafeInteger(index) || index < 1) {
      return {
        kind: 'error',
        text: t.approveInvalid(arg ?? ''),
      }
    }
    const denies = lastDeniedVerdicts(session.events, index)
    const target = denies[index - 1]
    if (target === undefined) {
      return { kind: 'error', text: t.approveNone(index, denies.length) }
    }
    ;(session.append as unknown as OverrideAppend)('autoReview/override', {
      reviewId: target.reviewId,
      toolName: target.toolName,
    }, { ignorable: true })
    return {
      kind: 'success',
      text: t.approveResult(target.toolName, String(target.reviewId), Math.round(this.config.overrideTtlMs / 60_000)),
    }
  }
}

/**
 * Mount the plugin: resolve config, register the answerer and the
 * post-execute listener as effects, register the slash command, and register
 * the `autoReview` session projection (when the host provides the
 * session-projection capability — the web profile does; bare test mounts and
 * minimal compositions may not, and the answerer must not depend on it).
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
    description: messages(resolved.language).description,
    input: { hint: 'on|off|status|approve [n]' },
    handler: invocation => runtime.command(invocation),
  })
  if (ctx.get('sessionProjections') !== undefined) {
    ctx.inject(['sessionProjections'], scope => scope.sessionProjections.register(makeAutoReviewProjection(resolved.enableByDefault)))
  }
}
