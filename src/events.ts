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
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalOutcome, ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { RiskLevel } from './config.ts'

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
    }
  }
}

/** Why the answerer had no reviewer verdict — the closed fallback vocabulary. */
export type AutoReviewFallback = 'timeout' | 'cancelled' | 'unavailable' | 'schema'

/** The reviewer child's durable session identity, as recorded in verdict events. */
export type ReviewerSessionId = SessionId

/** Closed {@link AutoReviewFallback} list for runtime normalization. */
export const AUTO_REVIEW_FALLBACKS: readonly AutoReviewFallback[] = ['timeout', 'cancelled', 'unavailable', 'schema']

/** Identifies one `autoReview/verdict` audit event. */
export type AutoReviewVerdictId = Branded<'AutoReviewVerdictId'>

/**
 * Brand a string as an {@link AutoReviewVerdictId}.
 * @param id - the raw id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function AutoReviewVerdictId(id: string): AutoReviewVerdictId {
  return id as AutoReviewVerdictId
}

/** Stable marker prefix inside every injected deny reason, parsed by the invariant companion. */
export const DENY_MARKER = '[auto-review]'

/** Regex extracting the reviewId from an injected deny reason. */
export const DENY_MARKER_PATTERN = /\[auto-review\] review ([^\s]+) denied/u

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
 * How many AI verdicts the session's CURRENT open turn has consumed. A turn
 * without `turn/start` (or one already closed by `turn/end`) counts zero.
 * @param events - session events in log order.
 * @returns the verdict count inside the current open turn.
 */
export function autoReviewsInOpenTurn(events: readonly SessionEvent[]): number {
  let openSeq = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const type = (events[index] as SessionEvent).type
    if (type === 'turn/end') return 0
    if (type === 'turn/start') {
      openSeq = (events[index] as SessionEvent).seq
      break
    }
  }
  if (openSeq < 0) return 0
  let count = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.seq <= openSeq) break
    if (event.type === 'autoReview/verdict') count += 1
  }
  return count
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
 * Find the already-presented tool call the approval request refers to — the
 * `tool/call` event whose arguments the model produced and the UI streamed.
 * @param events - session events in log order.
 * @param callId - the exact call to find.
 * @returns the call's raw arguments JSON string, or undefined without one.
 */
export function findPresentedCall(events: readonly SessionEvent[], callId: CallId): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as SessionEvent
    if (event.type === 'tool/call' && event.data.callId === callId) return event.data.arguments
  }
  return undefined
}
