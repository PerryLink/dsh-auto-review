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
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequest, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-subagent'
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { CallId } from './call-id.ts'
import { isMarkedAuditEvent, isUnmarkedHostVersion, peerSessionVersion, type AuditSupport } from './audit.ts'
import { fingerprint, VerdictCache } from './cache.ts'
import { hasAiPolicy, resolveConfig, riskExceeds } from './config.ts'
import type { Config, ResolvedConfig, ToolReviewPolicy } from './config.ts'
import { guardReviewerContext, ReviewerChildren } from './isolation.ts'
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
  findPresentedCall,
  lastDeniedVerdicts,
  neverResultText,
  plainCircuitResultText,
  plainDenyResultText,
  plainFallbackResultText,
  plainNeverResultText,
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
import type { OverrideContext, ReviewFailure, ReviewResolution } from './review.ts'

export const name = 'auto-review'
export const inject = ['approval', 'subagents', 'commands', 'tools']

/** How long an injected feedback text stays available for its tool result (bounded cleanup). */
const FEEDBACK_TTL_MS = 5 * 60_000

/** One recorded feedback text waiting for the denied/failed call's tool result. */
interface FeedbackEntry {
  readonly text: string
  readonly at: number
}

/** One in-memory verdict record (newest first), used when the host cannot stamp audit events. */
interface MemoryVerdict {
  readonly id: string
  readonly toolName: string
  /** Whether the verdict rejected (a deny, a risk-policy override, or a hard-disable). */
  readonly denial: boolean
}

/** One in-memory denial record for `/auto-review approve` (newest first). */
interface MemoryDenial {
  readonly id: string
  readonly toolName: string
}

/** One in-memory single-use human override (consumed by the next same-tool review). */
interface MemoryOverride {
  readonly reviewId: string
  readonly toolName: string
  readonly at: number
}

/**
 * The in-memory audit mirror for one session, used when the host's
 * `Session.append` cannot stamp the `ignorable` envelope marker (the
 * rc.6 line): nothing is written to the session log, and every audit
 * feature the reviewer needs keeps working for the session lifetime —
 * budgets, the rejection circuit breaker, the on/off override, and
 * `/auto-review approve`. Turn-scoped entries reset when the open turn
 * advances (detected from first-party `turn/start`/`turn/end` events).
 */
interface SessionMemory {
  /** Seq of the open turn/start these counters belong to; undefined between turns. */
  turnSeq: number | undefined
  /** All verdicts of the open turn, newest first, bounded to the breaker window. */
  verdicts: MemoryVerdict[]
  /** Reviewer failures in the open turn. */
  failures: number
  /** Hard-disable (never) rejections in the open turn. */
  rejections: number
  /** Denials of the open turn, newest first (bounded) — the `approve` feed. */
  denies: MemoryDenial[]
  /** The in-memory circuit trip of the open turn, when tripped. */
  circuit: SessionEventMap['autoReview/circuit'] | undefined
  /** The in-memory `/auto-review on|off` override for the session. */
  enabledOverride: boolean | undefined
  /** Pending single-use human overrides (bounded). */
  overrides: MemoryOverride[]
}

/** Cap on the in-memory denial feed (approve indexes are bounded by this). */
const MEMORY_DENIES_CAP = 200

/** Cap on the in-memory override list (a session cannot meaningfully accumulate more). */
const MEMORY_OVERRIDES_CAP = 50

/** Turn-scoped statistics folded from the in-memory mirror (the `/auto-review status` feed on audit-disabled hosts). */
interface MemoryStats {
  readonly allows: number
  readonly denies: number
  readonly fallbacks: number
  readonly rejections: number
  readonly avgDurationMs: number
  readonly recent: readonly { readonly toolName: string; readonly decision?: 'allow' | 'deny' }[]
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
 * owned by the ctx.on / commands.register effects in {@link apply}, plus the
 * teardown effect that clears the pending circuit-breaker timers.
 */
export class AutoReviewRuntime {
  /**
   * Live reviewer children — their approval asks never re-enter AI review,
   * and their steps are stripped of injected context by
   * {@link AutoReviewRuntime.guardReviewerContext}.
   */
  private readonly reviewerSessions = new ReviewerChildren()

  /** Feedback texts keyed by call id, consumed (and deleted) by the post-execute listener. */
  private readonly feedback = new Map<CallId, FeedbackEntry>()

  /** Whether the host honors the audit envelope's `ignorable` marker: unknown until the first append (or the peer-version pre-check). */
  private auditSupport: AuditSupport = 'unknown'

  /** In-memory audit mirrors per session, used when the host cannot stamp audit events. */
  private readonly memory = new WeakMap<Session, SessionMemory>()

  /** The one-time warning that session-log audit was disabled was already logged. */
  private warnedUnmarked = false

  /** Pending circuit-breaker abort-turn timers, cleared when the plugin unloads. */
  private readonly pendingAborts = new Set<ReturnType<typeof setTimeout>>()

  /** Same-fingerprint verdict cache (TTL + eviction only; no verdict semantics). */
  private readonly cache: VerdictCache

  constructor(
    private readonly ctx: Context,
    readonly config: ResolvedConfig,
  ) {
    this.cache = new VerdictCache({ ttlMs: config.verdictCacheTtlMs, maxEntries: config.verdictCacheMaxEntries })
  }

  // --- Audit-host capability (ignorable envelope marker) --------------------

  /**
   * Whether the session-log audit may append now: enabled when the host
   * stamps the `ignorable` marker (peer-version pre-check, then the append
   * probe) or when `allowUnmarkedAudit` opts back in. Degrades to the
   * in-memory mirror otherwise, with a one-time warning. Decides BEFORE the
   * first append: an unresolvable version also fails closed (host
   * `0.1.2-alpha.1`+ rejects unknown event types on read, so a probe append
   * would pollute the log).
   * @returns true when audit appends are safe on this host.
   */
  private auditMayAppend(): boolean {
    if (this.config.allowUnmarkedAudit) return true
    if (this.auditSupport === 'unsupported') return false
    if (this.auditSupport === 'unknown') {
      const version = peerSessionVersion()
      if (version === null || isUnmarkedHostVersion(version)) {
        this.auditSupport = 'unsupported'
        this.warnUnmarkedAuditHost()
        return false
      }
    }
    return true // a recognized marker-aware future line: append once and probe the envelope
  }

  /** After the first append on an unversioned host, probe the returned envelope for the ignorable marker. */
  private probeAuditResult(result: unknown): void {
    if (this.auditSupport !== 'unknown' || this.config.allowUnmarkedAudit) return
    if (isMarkedAuditEvent(result)) {
      this.auditSupport = 'supported'
    } else {
      this.auditSupport = 'unsupported'
      this.warnUnmarkedAuditHost()
    }
  }

  /** One-time warning that session-log audit was disabled to keep session logs loadable. */
  private warnUnmarkedAuditHost(): void {
    if (this.warnedUnmarked) return
    this.warnedUnmarked = true
    this.ctx.logger.warn(
      'auto-review: this host drops the ignorable marker on audit events or rejects unknown event types on read (Session.append predates the marker / fail-closed event vocabulary), which would make sessions unresumable — session-log audit is disabled and an in-memory mirror takes over; set allowUnmarkedAudit: true to opt back in, and repair already-polluted logs with scripts/repair-session-logs.mjs from dsh-permission-rules',
    )
  }

  // --- In-memory audit mirror (hosts without the ignorable marker) ----------

  /** The seq of the open turn/start, or undefined between turns (first-party events exist on every host). */
  private openTurnSeq(session: Session): number | undefined {
    let start: number | undefined
    for (const event of session.events) {
      if (event.type === 'turn/start') start = event.seq
      else if (event.type === 'turn/end') start = undefined
    }
    return start
  }

  /** The in-memory audit mirror for a session, reset when the open turn advances. */
  private memoryFor(session: Session): SessionMemory {
    const turnSeq = this.openTurnSeq(session)
    let entry = this.memory.get(session)
    if (entry === undefined || entry.turnSeq !== turnSeq) {
      entry = {
        turnSeq,
        verdicts: [],
        failures: 0,
        rejections: 0,
        denies: [],
        circuit: undefined,
        enabledOverride: undefined,
        overrides: [],
      }
      this.memory.set(session, entry)
    }
    return entry
  }

  /** Record one settled review outcome in the in-memory mirror (audit-disabled hosts). */
  private recordVerdictMemory(memory: SessionMemory, verdict: MemoryVerdict): void {
    memory.verdicts.unshift(verdict)
    if (memory.verdicts.length > this.config.circuitBreaker.windowSize) memory.verdicts.length = this.config.circuitBreaker.windowSize
    if (verdict.denial) {
      memory.denies.unshift({ id: verdict.id, toolName: verdict.toolName })
      if (memory.denies.length > MEMORY_DENIES_CAP) memory.denies.length = MEMORY_DENIES_CAP
    }
  }

  /** The number of leading consecutive denials in a newest-first verdict list. */
  private static leadingDenials(verdicts: readonly MemoryVerdict[]): number {
    let count = 0
    for (const verdict of verdicts) {
      if (!verdict.denial) break
      count += 1
    }
    return count
  }

  /** The per-turn metrics the caller should read: event folds on marker-aware hosts, the memory mirror otherwise. */
  private verdictsInOpenTurn(session: Session, memory: SessionMemory): number {
    return this.auditMayAppend() ? autoReviewsInOpenTurn(session.events) : memory.verdicts.length
  }

  private failuresInOpenTurn(session: Session, memory: SessionMemory): number {
    return this.auditMayAppend() ? autoReviewFailuresInOpenTurn(session.events) : memory.failures
  }

  private circuitFor(session: Session, memory: SessionMemory): SessionEventMap['autoReview/circuit'] | undefined {
    return this.auditMayAppend() ? circuitInOpenTurn(session.events) : memory.circuit
  }

  /** The pending one-shot override for a tool: the event fold on marker-aware hosts, the memory mirror otherwise. */
  private activeOverrideFor(session: Session, memory: SessionMemory, toolName: string, now: number): AutoReviewVerdictId | undefined {
    if (this.auditMayAppend()) return activeOverride(session.events, toolName, this.config.overrideTtlMs, now)
    const index = memory.overrides.findIndex(override =>
      override.toolName === toolName && now - override.at <= this.config.overrideTtlMs)
    if (index < 0) return undefined
    const [override] = memory.overrides.splice(index, 1)
    return override === undefined ? undefined : override.reviewId as unknown as AutoReviewVerdictId
  }

  /** Turn-scoped statistics from the in-memory mirror (audit-disabled hosts), in the {@link reviewStats} shape. */
  private memoryStats(memory: SessionMemory): MemoryStats {
    let allows = 0
    let denies = 0
    for (const verdict of memory.verdicts) {
      if (verdict.denial) denies += 1
      else allows += 1
    }
    return {
      allows,
      denies,
      fallbacks: memory.failures,
      rejections: memory.rejections,
      avgDurationMs: 0,
      recent: memory.verdicts.slice(0, 10).map(verdict => ({
        toolName: verdict.toolName,
        decision: verdict.denial ? 'deny' as const : 'allow' as const,
      })),
    }
  }

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
    const memory = this.memoryFor(session)
    const enabled = effectiveAutoReviewState(session.events) ?? memory.enabledOverride ?? this.config.enableByDefault
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
    if (this.verdictsInOpenTurn(session, memory) >= this.config.maxReviewsPerTurn) return next()
    if (this.failuresInOpenTurn(session, memory) >= this.config.maxFailuresPerTurn) return next()
    const circuit = this.circuitFor(session, memory)
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
    const overrideId = this.activeOverrideFor(session, memory, request.toolName, Date.now())
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
    const session = request.agent.session
    const memory = this.memoryFor(session)
    const auditOk = this.auditMayAppend()
    if (auditOk) {
      const result = (session.append as unknown as RejectionAppend)('autoReview/rejection', {
        rejectionId,
        ...approvalId !== undefined ? { approvalId } : {},
        toolName: request.toolName,
        ...request.callId !== undefined ? { callId: request.callId } : {},
        reason,
        outcome: 'rejected',
      }, { ignorable: true })
      this.probeAuditResult(result)
    } else {
      // Mirror of the event-mode semantics: a hard-disable rejection counts
      // toward the rejections stat but never toward the verdict breaker.
      memory.rejections += 1
    }
    const text = auditOk
      ? neverResultText(rejectionId, request.toolName, reason)
      : plainNeverResultText(request.toolName, reason)
    this.recordFeedback(request.callId, `${text}\n${this.config.denyGuidance}`)
    return Promise.resolve<ApprovalOutcome>('rejected')
  }

  /**
   * The same-fingerprint cache key for a pending request, or undefined when
   * the verdict is not replayable from `tool + arguments` alone: the cache is
   * disabled (`verdictCacheTtlMs: 0`), the reviewer transcript is enabled
   * (the verdict depends on session context), or the log lacks a parseable
   * presented call. The caller also bypasses the cache for a pending human
   * override, which changes the reviewer's evidence.
   * @param request - the pending approval request.
   * @returns the fingerprint, or undefined to skip the cache (fail-closed:
   *   the request then runs the second model as before).
   */
  private fingerprintFor(request: ApprovalRequest): string | undefined {
    if (this.config.verdictCacheTtlMs <= 0) return undefined
    if (this.config.contextBudget.turns > 0) return undefined
    if (request.callId === undefined) return undefined
    const raw = findPresentedCall(request.agent.session.events, request.callId)
    return fingerprint(request.toolName, raw)
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
    const cacheKey = this.fingerprintFor(request)
    let resolution: ReviewResolution
    let cached = false
    if (cacheKey !== undefined && override === undefined) {
      const hit = this.cache.get(cacheKey, started)
      if (hit !== undefined) {
        resolution = { ...hit }
        cached = true
      } else {
        resolution = await runReview(this.ctx, this.config, request, this.reviewerSessions, override)
        if (!isReviewFailure(resolution)) {
          this.cache.set(cacheKey, {
            decision: resolution.decision,
            reason: resolution.reason,
            ...resolution.riskLevel !== undefined ? { riskLevel: resolution.riskLevel } : {},
          }, started)
        }
      }
    } else {
      resolution = await runReview(this.ctx, this.config, request, this.reviewerSessions, override)
    }
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
    const auditOk = this.auditMayAppend()
    if (auditOk) {
      const result = (request.agent.session.append as unknown as VerdictAppend)('autoReview/verdict', {
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
        ...cached ? { cached: true } : {},
      }, { ignorable: true })
      this.probeAuditResult(result)
    } else {
      this.recordVerdictMemory(this.memoryFor(request.agent.session), {
        id: String(reviewId),
        toolName: request.toolName,
        denial: resolution.decision === 'deny' || (overridden && outcome === 'rejected'),
      })
    }
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
    const session = request.agent.session
    const auditOk = this.auditMayAppend()
    if (approvalId !== undefined) {
      const reviewId = newVerdictId()
      if (auditOk) {
        const result = (session.append as unknown as VerdictAppend)('autoReview/verdict', {
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
        this.probeAuditResult(result)
      } else {
        this.memoryFor(session).failures += 1
      }
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
    const text = this.auditMayAppend()
      ? circuitResultText(circuit.circuitId, request.toolName, explanation)
      : plainCircuitResultText(request.toolName, explanation)
    this.recordFeedback(request.callId, text)
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
    const memory = this.memoryFor(session)
    const auditOk = this.auditMayAppend()
    if ((auditOk ? circuitInOpenTurn(session.events) : memory.circuit) !== undefined) return
    const { consecutiveDenies, windowDenies, windowSize, action } = this.config.circuitBreaker
    const consecutive = auditOk ? consecutiveDeniesInOpenTurn(session.events) : AutoReviewRuntime.leadingDenials(memory.verdicts)
    const trip = consecutive >= consecutiveDenies
      ? { kind: 'consecutive' as const, count: consecutive }
      : (() => {
        const window = auditOk
          ? deniesInRecentVerdicts(session.events, windowSize)
          : memory.verdicts.slice(0, windowSize).filter(verdict => verdict.denial).length
        return window >= windowDenies ? { kind: 'window' as const, count: window } : undefined
      })()
    if (trip === undefined) return
    const circuitId = newCircuitId()
    if (auditOk) {
      const result = (session.append as unknown as CircuitAppend)('autoReview/circuit', {
        circuitId,
        action,
        trip,
        toolName: request.toolName,
      }, { ignorable: true })
      this.probeAuditResult(result)
    } else {
      memory.circuit = { circuitId, action, trip, toolName: request.toolName }
    }
    this.ctx.logger.warn(`auto-review circuit breaker tripped (${trip.kind}: ${trip.count}) by ${request.toolName}; action=${action}`)
    if (action === 'abort-turn') {
      request.agent.inject(createUserMessage({
        content: [{ type: 'text', text: messages(this.config.language).circuitNotice(trip.kind, trip.count) }],
        source: { kind: 'plugin', plugin: 'auto-review' },
      }))
      const timer = setTimeout(() => {
        this.pendingAborts.delete(timer)
        request.agent.cancel({ kind: 'hook', reason: `auto-review circuit breaker: ${trip.kind} ${trip.count}` })
      }, 0)
      this.pendingAborts.add(timer)
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
   * denied call's tool result. On hosts whose audit envelope cannot be
   * written the text is marker-free — the injected text itself becomes the
   * logged tool result, so model-visible ⟺ logged still holds.
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
    const text = this.auditMayAppend()
      ? denyResultText(reviewId, toolName, reason)
      : plainDenyResultText(toolName, reason)
    this.recordFeedback(callId, `${text}\n${this.config.denyGuidance}`)
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
    const text = this.auditMayAppend()
      ? fallbackResultText(reviewId, fallback, truncate(error, this.config.reasonMaxChars))
      : plainFallbackResultText(fallback, truncate(error, this.config.reasonMaxChars))
    this.recordFeedback(callId, text)
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
    const memory = this.memoryFor(session)
    const t = messages(this.config.language)
    const input = invocation.rawInput.trim().toLowerCase()
    if (input.startsWith('approve')) return this.approveCommand(invocation)
    const current = effectiveAutoReviewState(session.events) ?? memory.enabledOverride ?? this.config.enableByDefault
    if (input === 'status' || input === '') {
      const auditOk = this.auditMayAppend()
      const stats = auditOk ? reviewStats(session.events) : this.memoryStats(memory)
      const circuit = auditOk ? circuitInOpenTurn(session.events) : memory.circuit
      const recent = stats.recent.length === 0
        ? []
        : [t.recentLine(stats.recent.map(verdict => {
          const label = verdict.decision !== undefined
            ? verdict.decision
            : `fallback(${(verdict as { fallback?: string }).fallback ?? '?'})`
          return `${verdict.toolName}: ${label}`
        }).join(', '))]
      const verdictsUsed = auditOk ? autoReviewsInOpenTurn(session.events) : memory.verdicts.length
      const failuresUsed = auditOk ? autoReviewFailuresInOpenTurn(session.events) : memory.failures
      const auditOff = !auditOk && !this.config.allowUnmarkedAudit
      return {
        kind: 'success',
        text: [
          t.statusLine(current),
          t.verdictsLine(verdictsUsed, this.config.maxReviewsPerTurn),
          t.failuresLine(failuresUsed, this.config.maxFailuresPerTurn),
          ...circuit === undefined ? [] : [t.circuitLine(circuit.trip.kind, circuit.trip.count, circuit.action)],
          t.allTimeLine(stats.allows, stats.denies, stats.fallbacks, stats.rejections, stats.avgDurationMs),
          ...recent,
          ...auditOff ? [t.auditDisabledNotice] : [],
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
    if (this.auditMayAppend()) {
      const result = (session.append as unknown as StateAppend)('autoReview/state', { enabled }, { ignorable: true })
      this.probeAuditResult(result)
    } else {
      memory.enabledOverride = enabled
    }
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
    const memory = this.memoryFor(session)
    const t = messages(this.config.language)
    const arg = invocation.rawInput.trim().split(/\s+/u)[1]
    const index = arg === undefined ? 1 : Number.parseInt(arg, 10)
    if (!Number.isSafeInteger(index) || index < 1) {
      return {
        kind: 'error',
        text: t.approveInvalid(arg ?? ''),
      }
    }
    const auditOk = this.auditMayAppend()
    const denies = auditOk
      ? lastDeniedVerdicts(session.events, index)
      : memory.denies.slice(0, index).map(denial => ({
        reviewId: denial.id as unknown as AutoReviewVerdictId,
        toolName: denial.toolName,
      }))
    const target = denies[index - 1]
    if (target === undefined) {
      return { kind: 'error', text: t.approveNone(index, denies.length) }
    }
    if (auditOk) {
      const result = (session.append as unknown as OverrideAppend)('autoReview/override', {
        reviewId: target.reviewId,
        toolName: target.toolName,
      }, { ignorable: true })
      this.probeAuditResult(result)
    } else {
      memory.overrides.push({ reviewId: String(target.reviewId), toolName: target.toolName, at: Date.now() })
      if (memory.overrides.length > MEMORY_OVERRIDES_CAP) memory.overrides.splice(0, memory.overrides.length - MEMORY_OVERRIDES_CAP)
    }
    return {
      kind: 'success',
      text: t.approveResult(target.toolName, String(target.reviewId), Math.round(this.config.overrideTtlMs / 60_000)),
    }
  }

  /**
   * The `agent/pre-step` context firewall: for a reviewer child only, drop
   * every message the step would carry that is not the reviewer's own prompt
   * or one of its read-only tool results. See `./isolation.ts` for why the
   * reviewer must not read workspace instructions, the runtime-context
   * snapshot, or third-party context injections.
   * @param payload - the proposed step.
   * @param next - the rest of the pre-step waterfall.
   * @returns the decision, with injected context removed for reviewer children.
   */
  guardReviewerContext(
    payload: { agent: Agent; messages: UserMessage[] },
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> {
    return guardReviewerContext(this.reviewerSessions, payload, next)
  }

  /** Clear every pending circuit-breaker abort-turn timer; called by the plugin fiber's teardown effect. */
  dispose(): void {
    for (const timer of this.pendingAborts) clearTimeout(timer)
    this.pendingAborts.clear()
  }
}

/**
 * Mount the plugin: resolve config, register the answerer, the post-execute
 * listener and the reviewer context firewall as effects, register the slash
 * command, and register
 * the `autoReview` session projection (when the host provides the
 * session-projection capability — the web profile does; bare test mounts and
 * minimal compositions may not, and the answerer must not depend on it).
 * @param ctx - the host context.
 * @param config - raw plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  // `turns: 0` is a legitimate opt-out (see ContextBudgetConfig), but combined
  // with any `ai` policy it is the deny-everything configuration: the reviewer
  // never sees the request, judges the evidence insufficient, and its own
  // verdict rule turns that into a denial of every user-authorized action.
  // Say so once at mount instead of letting it read as a broken reviewer.
  if (resolved.contextBudget.turns === 0 && hasAiPolicy(resolved)) {
    ctx.logger.warn(
      'auto-review: contextBudget.turns is 0 while at least one tool or risk-rule policy is "ai", so the reviewer is asked to decide without any transcript — it cannot see the user\'s request and its own rule ("when unsure, DENY") will reject user-authorized actions. Set contextBudget.turns to a small non-zero value (the default is 2), or route those tools to "human" instead.',
    )
  }
  const runtime = new AutoReviewRuntime(ctx, resolved)
  // Unloading the plugin clears any pending circuit-breaker abort-turn timer.
  ctx.effect(() => () => runtime.dispose(), 'dsh-auto-review: runtime teardown')
  // The resolved runtime is also published as a service so in-process
  // consumers (the dsh-eval engine) read the exact mounted configuration
  // instead of re-resolving a second, driftable copy.
  ctx.provide('autoReviewRuntime', runtime)
  ctx.on('approval/request', (request, next) => runtime.answer(request, next))
  ctx.on('tools/post-execute', (exec, result, next) => runtime.injectDenyReason(exec, result, next))
  // `prepend: true` puts the firewall OUTSIDE every pre-step listener already
  // registered, so it sees the final message list and removes injected
  // context whoever added it — the loop's own runtime-context snapshot
  // included. Non-reviewer steps pass through untouched.
  ctx.on('agent/pre-step', (payload, next) => runtime.guardReviewerContext(payload, next), { prepend: true })
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
