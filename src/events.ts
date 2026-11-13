/**
 * Durable session vocabulary for `dsh-auto-review`: the `autoReview/state`
 * per-session override, the `autoReview/verdict` audit event, and the pure
 * folds that read them back from a session log.
 *
 * The model-visible ⟺ logged invariant holds by construction: the verdict is
 * log-only (UI-auditable, never in the model transcript), and the only
 * model-visible auto-review content is the deny reason injected into the
 * denied call's `tool/result`, which carries the `reviewId` marker that links
 * it back to this event.
 * @module dsh-auto-review/events
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import { CallId } from './call-id.ts'
import type { SessionEvent, SessionEventMap, SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { CircuitAction, RiskLevel } from './config.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's auto-review switch — log-only, durable, replayable, last
     * event wins (like `approval/policy`). The `/auto-review` command writes
     * it; absent means the configured `enableByDefault`.
     */
    'autoReview/state': {
      enabled: boolean
    }
    /**
     * One auto-review decision — log-only audit. `approvalId` links back to
     * the `approval/asked` event and forward to the `approval/decided` pair,
     * completing the reconstruction chain. `resolution` distinguishes a real
     * reviewer verdict (`decision`/`reason`/`riskLevel` present, `fallback`
     * absent) from a fallback (the converse). `outcome` is present only when
     * the answerer claimed the request; a `delegate` fallback omits it
     * because the chain continues downstream.
     */
    'autoReview/verdict': {
      reviewId: AutoReviewVerdictId
      approvalId: ApprovalRequestId
      toolName: string
      callId?: CallId
      provider: string
      model?: string
      reviewerSessionId?: SessionId
      durationMs: number
      decision?: 'allow' | 'deny'
      reason?: string
      riskLevel?: RiskLevel
      outcome?: ApprovalOutcome
      fallback?: AutoReviewFallback
      error?: string
      /**
       * Present when the reviewer ALLOWED but the verdict did not settle the
       * request: the risk policy overrode the allow (the request delegated to
       * the human chain, or was deterministically denied per `onHighRisk`).
       * A risk-policy override never carries `outcome: 'allowed-once'`.
       */
      escalation?: 'risk-policy'
      /**
       * Present when this verdict was replayed from the same-fingerprint
       * cache (no reviewer subagent ran): decision/reason/riskLevel were
       * copied from a recent identical `tool + arguments` verdict within
       * `verdictCacheTtlMs`. A cached verdict still settles exactly like a
       * real one (risk policy, circuit breaker, deny feedback all apply).
       */
      cached?: true
    }
    /**
     * The rejection circuit breaker tripped — log-only audit, once per turn.
     * `circuitId` links the injected circuit-rejection marker back here.
     */
    'autoReview/circuit': {
      circuitId: AutoReviewCircuitId
      action: CircuitAction
      trip: { kind: 'consecutive' | 'window'; count: number }
      toolName: string
    }
    /**
     * A human one-shot override: the user explicitly authorized ONE retry of
     * a previously denied action (the referenced deny verdict). Log-only;
     * consumed by the next same-tool review within `overrideTtlMs`.
     */
    'autoReview/override': {
      reviewId: AutoReviewVerdictId
      toolName: string
    }
    /**
     * A deterministic hard-disable rejection (`never` policy): a risk rule or
     * the tool policy table refused the request BEFORE any reviewer ran, and
     * the answerer settled `rejected`. Log-only audit; `rejectionId` links the
     * injected `[auto-review-never]` feedback text back here. `approvalId` is
     * present whenever the pending `approval/asked` event could be correlated
     * (like verdicts, at most one verdict-or-rejection exists per asked).
     */
    'autoReview/rejection': {
      rejectionId: AutoReviewRejectionId
      approvalId?: ApprovalRequestId
      toolName: string
      callId?: CallId
      /** Why the request was hard-disabled (the matched risk rule or policy table entry). */
      reason: string
      outcome: 'rejected'
    }
  }
}

/**
 * `Session.append` narrowed to the `autoReview/state` event. The options bag
 * exists only on host builds that expose the `ignorable` envelope-marker
 * surface (post-rc.6 `@deepseek-ai/dsh-session`); an rc.6 host accepts and
 * ignores the third argument, appending the identical event without the
 * marker — no behavior change, no failure either way.
 */
export type StateAppend = (
  type: 'autoReview/state',
  data: SessionEventMap['autoReview/state'],
  options?: { ignorable?: true },
) => unknown

/**
 * `Session.append` narrowed to the `autoReview/verdict` event — same
 * `ignorable`-marker contract as {@link StateAppend}.
 */
export type VerdictAppend = (
  type: 'autoReview/verdict',
  data: SessionEventMap['autoReview/verdict'],
  options?: { ignorable?: true },
) => unknown

/** `Session.append` narrowed to the `autoReview/circuit` event — same contract as {@link VerdictAppend}. */
export type CircuitAppend = (
  type: 'autoReview/circuit',
  data: SessionEventMap['autoReview/circuit'],
  options?: { ignorable?: true },
) => unknown

/** `Session.append` narrowed to the `autoReview/override` event — same contract as {@link VerdictAppend}. */
export type OverrideAppend = (
  type: 'autoReview/override',
  data: SessionEventMap['autoReview/override'],
  options?: { ignorable?: true },
) => unknown

/** `Session.append` narrowed to the `autoReview/rejection` event — same contract as {@link VerdictAppend}. */
export type RejectionAppend = (
  type: 'autoReview/rejection',
  data: SessionEventMap['autoReview/rejection'],
  options?: { ignorable?: true },
) => unknown

/** Why the answerer had no reviewer verdict — the closed fallback vocabulary. */
export type AutoReviewFallback = 'timeout' | 'cancelled' | 'unavailable' | 'schema'

/** The reviewer child's durable session identity, as recorded in verdict events. */
export type ReviewerSessionId = SessionId

/** Closed {@link AutoReviewFallback} list for runtime normalization. */
export const AUTO_REVIEW_FALLBACKS: readonly AutoReviewFallback[] = ['timeout', 'cancelled', 'unavailable', 'schema']

/** Identifies one `autoReview/verdict` audit event. */
export type AutoReviewVerdictId = Branded<'AutoReviewVerdictId'>

/** Identifies one `autoReview/circuit` audit event. */
export type AutoReviewCircuitId = Branded<'AutoReviewCircuitId'>

/** Identifies one `autoReview/rejection` audit event. */
export type AutoReviewRejectionId = Branded<'AutoReviewRejectionId'>

/**
 * Brand a string as an {@link AutoReviewVerdictId}.
 * @param id - the raw id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function AutoReviewVerdictId(id: string): AutoReviewVerdictId {
  return id as AutoReviewVerdictId
}

/**
 * Brand a string as an {@link AutoReviewCircuitId}.
 * @param id - the raw id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function AutoReviewCircuitId(id: string): AutoReviewCircuitId {
  return id as AutoReviewCircuitId
}

/**
 * Brand a string as an {@link AutoReviewRejectionId}.
 * @param id - the raw id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function AutoReviewRejectionId(id: string): AutoReviewRejectionId {
  return id as AutoReviewRejectionId
}

/** Stable marker prefix inside every injected deny reason, parsed by the invariant companion. */
export const DENY_MARKER = '[auto-review]'

/** Regex extracting the reviewId from an injected deny reason. */
export const DENY_MARKER_PATTERN = /\[auto-review\] review ([^\s]+) denied/u

/** Stable marker prefix inside every injected fallback rejection text (a distinct vocabulary from {@link DENY_MARKER}). */
export const FALLBACK_MARKER = '[auto-review-fallback]'

/** Regex extracting the reviewId from an injected fallback rejection. */
export const FALLBACK_MARKER_PATTERN = /\[auto-review-fallback\] review ([^\s]+) failed/u

/** Stable marker prefix inside every injected circuit rejection text. */
export const CIRCUIT_MARKER = '[auto-review-circuit]'

/** Regex extracting the circuitId and tool name from an injected circuit rejection. */
export const CIRCUIT_MARKER_PATTERN = /\[auto-review-circuit\] circuit ([^\s]+) rejected tool "([^"]+)" before review/u

/** Stable marker prefix inside every injected hard-disable (`never`) rejection text. */
export const NEVER_MARKER = '[auto-review-never]'

/** Regex extracting the rejectionId and tool name from an injected never rejection. */
export const NEVER_MARKER_PATTERN = /\[auto-review-never\] rejection ([^\s]+) hard-disabled tool "([^"]+)"/u

/**
 * Build the model-visible deny text injected into a denied tool result. The
 * embedded reviewId is what makes the model-visible text reconstructable
 * from the session log (model-visible ⟺ logged).
 * @param reviewId - the verdict event's id.
 * @param toolName - the denied tool.
 * @param reason - the reviewer's reason (already truncated).
 * @returns the exact error text shown to the model.
 */
export function denyResultText(reviewId: AutoReviewVerdictId, toolName: string, reason: string): string {
  return `Error: ${DENY_MARKER} review ${reviewId} denied tool "${toolName}": ${reason}`
}

/**
 * Build the model-visible text injected into a tool result whose review
 * failed and was rejected by the fallback policy. The embedded reviewId
 * links it to the recorded fallback verdict (model-visible ⟺ logged).
 * @param reviewId - the fallback verdict event's id.
 * @param fallback - the failure category (timeout/unavailable/schema).
 * @param error - the failure detail (already truncated upstream).
 * @returns the exact error text shown to the model.
 */
export function fallbackResultText(reviewId: AutoReviewVerdictId, fallback: AutoReviewFallback, error: string): string {
  return `Error: ${FALLBACK_MARKER} review ${reviewId} failed (${fallback}) and the request was rejected: ${error}`
}

/**
 * Build the model-visible text injected into a tool result rejected by a
 * tripped circuit breaker. The embedded circuitId links it to the recorded
 * `autoReview/circuit` event (model-visible ⟺ logged).
 * @param circuitId - the circuit event's id.
 * @param toolName - the rejected tool.
 * @param explanation - why the breaker rejects (trip kind and count).
 * @returns the exact error text shown to the model.
 */
export function circuitResultText(circuitId: AutoReviewCircuitId, toolName: string, explanation: string): string {
  return `Error: ${CIRCUIT_MARKER} circuit ${circuitId} rejected tool "${toolName}" before review: ${explanation}`
}

/**
 * Build the model-visible text injected into a tool result rejected by a
 * `never` policy (a hard disable: risk rule or tool-policy table entry). The
 * embedded rejectionId links it to the recorded `autoReview/rejection` event
 * (model-visible ⟺ logged).
 * @param rejectionId - the rejection event's id.
 * @param toolName - the hard-disabled tool.
 * @param source - which rule or policy entry disabled it.
 * @returns the exact error text shown to the model.
 */
export function neverResultText(rejectionId: AutoReviewRejectionId, toolName: string, source: string): string {
  return `Error: ${NEVER_MARKER} rejection ${rejectionId} hard-disabled tool "${toolName}": ${source}`
}

/**
 * Marker-free deny text for hosts whose `Session.append` cannot stamp the
 * audit envelope (`ignorable` dropped — the rc.6 line): the audit event is
 * skipped to keep the log loadable, so the injected text must not embed an
 * id marker. The text itself becomes the logged tool result, which keeps
 * model-visible ⟺ logged.
 * @param toolName - the denied tool.
 * @param reason - the reviewer's reason (already truncated).
 * @returns the exact error text shown to the model.
 */
export function plainDenyResultText(toolName: string, reason: string): string {
  return `Error: the AI reviewer denied tool "${toolName}": ${reason}`
}

/**
 * Marker-free fallback text for hosts whose audit envelope cannot be
 * written (see {@link plainDenyResultText}).
 * @param fallback - the failure category.
 * @param error - the failure detail.
 * @returns the exact error text shown to the model.
 */
export function plainFallbackResultText(fallback: AutoReviewFallback, error: string): string {
  return `Error: the AI reviewer failed (${fallback}) and the request was rejected: ${error}`
}

/**
 * Marker-free circuit text for hosts whose audit envelope cannot be
 * written (see {@link plainDenyResultText}); the breaker itself still runs
 * from the in-memory mirror.
 * @param toolName - the rejected tool.
 * @param explanation - why the breaker rejects (trip kind and count).
 * @returns the exact error text shown to the model.
 */
export function plainCircuitResultText(toolName: string, explanation: string): string {
  return `Error: the rejection circuit breaker rejected tool "${toolName}" before review: ${explanation}`
}

/**
 * Marker-free hard-disable text for hosts whose audit envelope cannot be
 * written (see {@link plainDenyResultText}).
 * @param toolName - the hard-disabled tool.
 * @param source - which rule or policy entry disabled it.
 * @returns the exact error text shown to the model.
 */
export function plainNeverResultText(toolName: string, source: string): string {
  return `Error: tool "${toolName}" is hard-disabled by policy: ${source}`
}

/**
 * The session's auto-review override: the last `autoReview/state` event, or
 * `undefined` when the session never switched (callers apply the configured
 * `enableByDefault`). The pure fold — replay IS the state.
 * @param events - session events in log order (other types are skipped).
 * @returns the enabled flag of the last switch, or undefined without one.
 */
export function effectiveAutoReviewState(events: readonly SessionEvent[]): boolean | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'autoReview/state') return event.data.enabled
  }
  return undefined
}

/**
 * The verdict events inside the session's CURRENT open turn, oldest first.
 * A turn without `turn/start` (or one already closed by `turn/end`) yields
 * an empty list.
 * @param events - session events in log order.
 * @returns the open turn's verdict payloads.
 */
export function openTurnVerdicts(events: readonly SessionEvent[]): SessionEventMap['autoReview/verdict'][] {
  let openSeq = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = (events[index] as SessionEvent).type
    if (type === 'turn/end') return []
    if (type === 'turn/start') {
      openSeq = (events[index] as SessionEvent).seq
      break
    }
  }
  if (openSeq < 0) return []
  const verdicts: SessionEventMap['autoReview/verdict'][] = []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.seq <= openSeq) break
    if (event.type === 'autoReview/verdict') verdicts.push(event.data)
  }
  verdicts.reverse()
  return verdicts
}

/**
 * How many REAL AI verdicts the session's CURRENT open turn has consumed.
 * Fallback verdicts do not count: they are budgeted separately by
 * {@link autoReviewFailuresInOpenTurn}, so a failing reviewer does not eat
 * the AI-decision budget. A turn without `turn/start` (or one already closed
 * by `turn/end`) counts zero.
 * @param events - session events in log order.
 * @returns the decision-carrying verdict count inside the current open turn.
 */
export function autoReviewsInOpenTurn(events: readonly SessionEvent[]): number {
  return openTurnVerdicts(events).filter(data => data.decision !== undefined).length
}

/**
 * How many reviewer FAILURES the session's CURRENT open turn has consumed —
 * `autoReview/verdict` events carrying a fallback other than `cancelled`
 * (a user withdrawal is not a reviewer failure). The answerer delegates once
 * the budget is exhausted so a broken reviewer costs one timeout instead of
 * `maxFailuresPerTurn` of them.
 * @param events - session events in log order.
 * @returns the failure count inside the current open turn.
 */
export function autoReviewFailuresInOpenTurn(events: readonly SessionEvent[]): number {
  return openTurnVerdicts(events).filter(data => data.fallback !== undefined && data.fallback !== 'cancelled').length
}

/**
 * Whether a verdict is a denial of the request: a reviewer deny, or an allow
 * overridden by the risk policy (`escalation: 'risk-policy'` with the deny
 * outcome). The circuit breaker and the approve list count both.
 * @param data - the verdict payload.
 * @returns true when the request was denied.
 */
export function isDenial(data: SessionEventMap['autoReview/verdict']): boolean {
  return data.decision === 'deny' || data.escalation === 'risk-policy'
}

/**
 * The trailing run of consecutive denials in the current open turn —
 * the circuit breaker's `consecutiveDenies` signal.
 * @param events - session events in log order.
 * @returns the length of the trailing denial run.
 */
export function consecutiveDeniesInOpenTurn(events: readonly SessionEvent[]): number {
  const verdicts = openTurnVerdicts(events)
  let count = 0
  for (let index = verdicts.length - 1; index >= 0; index -= 1) {
    if (!isDenial(verdicts[index]!)) break
    count += 1
  }
  return count
}

/**
 * How many of the last {@link windowSize} decision verdicts in the current
 * open turn are denials — the circuit breaker's `windowDenies` signal.
 * @param events - session events in log order.
 * @param windowSize - how many recent verdicts the window counts.
 * @returns the denial count inside the window.
 */
export function deniesInRecentVerdicts(events: readonly SessionEvent[], windowSize: number): number {
  const decisions = openTurnVerdicts(events).filter(data => data.decision !== undefined)
  return decisions.slice(-windowSize).filter(data => isDenial(data)).length
}

/**
 * The current open turn's circuit trip, when one was recorded.
 * @param events - session events in log order.
 * @returns the last `autoReview/circuit` payload in the open turn, or undefined.
 */
export function circuitInOpenTurn(events: readonly SessionEvent[]): SessionEventMap['autoReview/circuit'] | undefined {
  let openSeq = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = (events[index] as SessionEvent).type
    if (type === 'turn/end') return undefined
    if (type === 'turn/start') {
      openSeq = (events[index] as SessionEvent).seq
      break
    }
  }
  if (openSeq < 0) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.seq <= openSeq) break
    if (event.type === 'autoReview/circuit') return event.data
  }
  return undefined
}

/** One recent deny verdict, as the approve command lists them. */
export interface RecentDeny {
  readonly reviewId: AutoReviewVerdictId
  readonly toolName: string
  readonly reason?: string
  readonly riskLevel?: RiskLevel
}

/**
 * The most recent deny verdicts, newest first — the `/auto-review approve`
 * candidate list.
 * @param events - session events in log order.
 * @param limit - how many to collect.
 * @returns up to {@link limit} deny verdicts, newest first.
 */
export function lastDeniedVerdicts(events: readonly SessionEvent[], limit: number): RecentDeny[] {
  const result: RecentDeny[] = []
  for (let index = events.length - 1; index >= 0 && result.length < limit; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type !== 'autoReview/verdict' || !isDenial(event.data)) continue
    const data = event.data
    result.push({
      reviewId: data.reviewId,
      toolName: data.toolName,
      ...data.reason !== undefined ? { reason: data.reason } : {},
      ...data.riskLevel !== undefined ? { riskLevel: data.riskLevel } : {},
    })
  }
  return result
}

/**
 * Whether a human one-shot override is pending for a tool: the latest
 * `autoReview/override` for the tool is still unconsumed (no verdict for the
 * tool after it) and unexpired. An override is consumed by the NEXT
 * same-tool review regardless of its decision — single-use by construction.
 * @param events - session events in log order.
 * @param toolName - the tool an approval request is about.
 * @param ttlMs - the override lifetime.
 * @param now - the current epoch milliseconds.
 * @returns the overridden deny verdict's id, or undefined without a pending override.
 */
export function activeOverride(
  events: readonly SessionEvent[],
  toolName: string,
  ttlMs: number,
  now: number,
): AutoReviewVerdictId | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'autoReview/verdict' && event.data.toolName === toolName) return undefined
    if (event.type === 'autoReview/override' && event.data.toolName === toolName) {
      return now - event.time <= ttlMs ? event.data.reviewId : undefined
    }
  }
  return undefined
}

/** Cumulative review statistics folded from the session log (status command). */
export interface ReviewStats {
  readonly allows: number
  readonly denies: number
  readonly fallbacks: number
  /** Hard-disable (`never` policy) rejections — no reviewer ran for these. */
  readonly rejections: number
  /** Mean duration of decision-carrying verdicts, rounded; 0 without any. */
  readonly avgDurationMs: number
  /** The last three verdicts, newest first. */
  readonly recent: readonly SessionEventMap['autoReview/verdict'][]
}

/**
 * Fold one session's review statistics: verdict counts, never-rejection
 * count, mean duration, and the three most recent verdicts.
 * @param events - session events in log order.
 * @returns the statistics.
 */
export function reviewStats(events: readonly SessionEvent[]): ReviewStats {
  let allows = 0
  let denies = 0
  let fallbacks = 0
  let rejections = 0
  let decided = 0
  let durationSum = 0
  for (const event of events) {
    if (event.type === 'autoReview/rejection') {
      rejections += 1
      continue
    }
    if (event.type !== 'autoReview/verdict') continue
    const data = event.data
    if (data.decision === 'allow') allows += 1
    else if (data.decision === 'deny') denies += 1
    else fallbacks += 1
    if (data.decision !== undefined) {
      decided += 1
      durationSum += data.durationMs
    }
  }
  const recent: SessionEventMap['autoReview/verdict'][] = []
  for (let index = events.length - 1; index >= 0 && recent.length < 3; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'autoReview/verdict') recent.push(event.data)
  }
  return { allows, denies, fallbacks, rejections, avgDurationMs: decided === 0 ? 0 : Math.round(durationSum / decided), recent }
}

/**
 * Correlate a pending approval request with the `approval/asked` event the
 * service just appended. The service appends the asked event synchronously
 * before waterfall dispatch, so the matching event is the last unpaired
 * asked event whose call id (or, without one, tool name) matches the request.
 * @param events - session events in log order.
 * @param toolName - the request's tool name.
 * @param callId - the request's call id, when present.
 * @returns the asked event's approval id, or undefined when the chain is broken.
 */
export function correlateApprovalId(
  events: readonly SessionEvent[],
  toolName: string,
  callId?: CallId,
): ApprovalRequestId | undefined {
  const decided = new Set<ApprovalRequestId>()
  let candidate: ApprovalRequestId | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'approval/decided') {
      decided.add(event.data.id)
      continue
    }
    if (event.type !== 'approval/asked') continue
    const asked = event.data
    if (decided.has(asked.id)) continue
    if (callId !== undefined ? asked.callId === callId : asked.toolName === toolName) {
      candidate = asked.id
      break
    }
  }
  return candidate
}

/**
 * Where a presented-call argument record came from.
 *
 * The host logs a native call as `tool/call` (arguments as a JSON string). A
 * PTC-folded call is a sub-dispatch: the `tool/call` on the log carries the
 * OUTER id (name `run_code`) while the approval carries the child id
 * `<outer>:ptc:<n>`, and the child's own `name`/`arguments` live on the
 * dispatch record — `tool/ptc-dispatch-start` when it starts, and its settled
 * pair `tool/ptc-dispatch` afterwards. Both carry the same normalized payload.
 */
export type PresentedCallSource = 'tool/call' | 'tool/ptc-dispatch-start' | 'tool/ptc-dispatch'

/** One tool-call argument record resolved for a pending approval. */
export interface PresentedCall {
  /**
   * The call id the RECORD carries. Equal to the requested id for the pending
   * call's own record; different when only an enclosing (PTC parent) call
   * resolved, which callers must disclose rather than present as the pending
   * call's own arguments.
   */
  readonly callId: string
  /** The tool name logged with the record ('' when the host omitted it). */
  readonly name: string
  /** Which event type supplied the arguments. */
  readonly source: PresentedCallSource
  /**
   * The arguments as JSON text: the native call's own logged string, or the
   * PTC dispatch record's already-normalized value re-serialized. Callers
   * parse, redact and truncate it exactly like a native call's arguments.
   */
  readonly argumentsText: string
}

/**
 * The outcome of resolving an approval request's call evidence from the log.
 * The three outcomes stay distinct on purpose: the reviewer prompt — and so
 * the deny reason quoted back to the model — must say WHICH gap it hit. A
 * missing `tool/call` row for a PTC id used to render as "not found or
 * unparseable", which read as "this call had no arguments" and made every
 * PTC escalation indistinguishable from an empty-argument call.
 */
export type PresentedCallLookup =
  /** The requested call's own record, or its nearest enclosing record. */
  | { readonly outcome: 'found'; readonly call: PresentedCall }
  /** No record in the log carries the requested id or any enclosing ancestor id. */
  | { readonly outcome: 'unresolved'; readonly parentCallId?: CallId }
  /** A record carries the id but no arguments payload at all. */
  | { readonly outcome: 'missing-arguments'; readonly source: PresentedCallSource; readonly callId: string }

/** The marker the host's PTC runtime puts between an outer call id and the sub-call number. */
const PTC_SUBCALL_MARKER = ':ptc:'

/** JSON text for one logged argument payload, or undefined when the payload is absent/serialization fails. */
function argumentsTextOf(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  try {
    const text = JSON.stringify(value)
    return text === undefined ? undefined : text
  } catch {
    return undefined
  }
}

/**
 * The enclosing call id of one PTC sub-call id (`<outer>:ptc:<n>` → `<outer>`),
 * or undefined when the id is not PTC-folded. Each strip removes the LAST
 * marker, so a nested sub-call walks out one level at a time.
 * @param callId - the id to strip.
 * @returns the enclosing id, or undefined when there is none.
 */
function enclosingCallId(callId: string): CallId | undefined {
  const at = callId.lastIndexOf(PTC_SUBCALL_MARKER)
  if (at <= 0) return undefined
  return CallId(callId.slice(0, at))
}

/** One PTC sub-dispatch row read structurally (the event type is declared by the host's PTC runtime, not by this package). */
interface PtcSubCallRecord {
  readonly type: 'tool/ptc-dispatch-start' | 'tool/ptc-dispatch'
  readonly subCallId: string
  readonly name: string
  readonly arguments: unknown
}

/**
 * Read one log row as a PTC sub-call record, or undefined for any other event.
 * `@deepseek-ai/dsh-tool-executor-ptc` owns the `SessionEventMap` entry and is
 * not a dependency of this package (a consumer profile installs it, or does
 * not), so the row is read by shape — the same approach the V3/V4 tool-result
 * reader takes for rows whose declaration lives on the host side.
 * @param event - one session event.
 * @returns the structurally-read record, or undefined.
 */
function readPtcSubCall(event: SessionEvent): PtcSubCallRecord | undefined {
  const type = (event as { type: string }).type
  if (type !== 'tool/ptc-dispatch-start' && type !== 'tool/ptc-dispatch') return undefined
  const data = (event as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  const subCallId = record['subCallId']
  if (typeof subCallId !== 'string' || subCallId === '') return undefined
  const name = record['name']
  return { type, subCallId, name: typeof name === 'string' ? name : '', arguments: record['arguments'] }
}

/**
 * The PTC dispatch record for one sub-call id, newest valid match first.
 * `tool/ptc-dispatch-start` wins over its settled `tool/ptc-dispatch` pair:
 * the started row is the one present while the approval is pending, and both
 * carry the same normalized arguments.
 * @param events - session events in log order.
 * @param subCallId - the child id to match.
 * @returns the record, or undefined.
 */
function findPtcSubCall(events: readonly SessionEvent[], subCallId: string): PtcSubCallRecord | undefined {
  let settled: PtcSubCallRecord | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const record = readPtcSubCall(events[index] as SessionEvent)
    if (record === undefined || record.subCallId !== subCallId) continue
    if (record.type === 'tool/ptc-dispatch') {
      settled ??= record
      continue
    }
    return record
  }
  return settled
}

/** The result of looking up ONE exact id in the log. */
type IdLookup =
  | { readonly hit: 'found'; readonly call: PresentedCall }
  | { readonly hit: 'missing-arguments'; readonly source: PresentedCallSource }
  | { readonly hit: 'absent' }

/**
 * Look one exact call id up in the log: the PTC child-call record first, then
 * the native `tool/call`. Preferring the child record is what keeps a PTC
 * approval's evidence the INNER tool's own arguments instead of a fallback to
 * its enclosing `run_code`.
 * @param events - session events in log order.
 * @param callId - the exact id to match.
 * @returns the hit; `absent` when no row carries the id at all.
 */
function lookupCallId(events: readonly SessionEvent[], callId: string): IdLookup {
  const ptc = findPtcSubCall(events, callId)
  const ptcText = ptc === undefined ? undefined : argumentsTextOf(ptc.arguments)
  if (ptc !== undefined && ptcText !== undefined) {
    return { hit: 'found', call: { callId, name: ptc.name, source: ptc.type, argumentsText: ptcText } }
  }
  // A host that logs the inner call natively as well may carry the payload
  // there, so try it before reporting the child record as empty.
  let nativeWithoutPayload = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type !== 'tool/call' || String(event.data.callId) !== callId) continue
    const argumentsText = argumentsTextOf(event.data.arguments)
    if (argumentsText === undefined) {
      nativeWithoutPayload = true
      break
    }
    return { hit: 'found', call: { callId, name: event.data.name, source: 'tool/call', argumentsText } }
  }
  if (ptc !== undefined) return { hit: 'missing-arguments', source: ptc.type }
  if (nativeWithoutPayload) return { hit: 'missing-arguments', source: 'tool/call' }
  return { hit: 'absent' }
}

/**
 * Resolve the already-presented call the approval request refers to — the
 * record whose arguments the model produced and the UI streamed.
 *
 * Lookup order:
 * 1. the pending call's own PTC sub-dispatch record, keyed by `subCallId`
 *    (a PTC approval carries the inner id there);
 * 2. the pending call's own native `tool/call`;
 * 3. for a PTC id `<outer>:ptc:<n>`, the nearest ENCLOSING row, walking out
 *    one `:ptc:` level at a time (`<outer>` is normally the `run_code`
 *    `tool/call` that dispatched the program). Callers see
 *    `call.callId !== requested` and must label it as enclosing evidence.
 *
 * A row that exists but has no arguments payload is reported as
 * `missing-arguments`, separately from `unresolved` (no row at all).
 * @param events - session events in log order.
 * @param callId - the approval request's call id.
 * @returns the resolution, never a throw.
 */
export function resolvePresentedCall(events: readonly SessionEvent[], callId: CallId): PresentedCallLookup {
  const requested = String(callId)
  const own = lookupCallId(events, requested)
  if (own.hit === 'found') return { outcome: 'found', call: own.call }
  if (own.hit === 'missing-arguments') {
    return { outcome: 'missing-arguments', source: own.source, callId: requested }
  }
  // PTC-folded: the approval carries the inner id, the logged row the outer
  // one. Walk out to the nearest enclosing row and let the caller disclose it.
  let enclosing = enclosingCallId(requested)
  const firstParent = enclosing
  while (enclosing !== undefined) {
    const parentId = String(enclosing)
    const parent = lookupCallId(events, parentId)
    if (parent.hit === 'found') return { outcome: 'found', call: parent.call }
    if (parent.hit === 'missing-arguments') {
      return { outcome: 'missing-arguments', source: parent.source, callId: parentId }
    }
    enclosing = enclosingCallId(parentId)
  }
  return firstParent === undefined
    ? { outcome: 'unresolved' }
    : { outcome: 'unresolved', parentCallId: firstParent }
}

/**
 * Find the already-presented tool call the approval request refers to — the
 * record whose arguments the model produced and the UI streamed. A PTC
 * sub-call (`<outer>:ptc:<n>`) resolves through its child dispatch record
 * first and its enclosing `tool/call` second, exactly like
 * {@link resolvePresentedCall}; use that function when the distinction
 * between "no row" and "no payload" matters.
 * @param events - session events in log order.
 * @param callId - the exact call to find.
 * @returns the call's arguments JSON string, or undefined without one.
 */
export function findPresentedCall(events: readonly SessionEvent[], callId: CallId): string | undefined {
  const lookup = resolvePresentedCall(events, callId)
  return lookup.outcome === 'found' ? lookup.call.argumentsText : undefined
}
