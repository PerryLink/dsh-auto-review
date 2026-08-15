/**
 * Package-owned invariant companion for `dsh-auto-review`:
 *
 * 1. Every `autoReview/verdict` audit event references an `approval/asked`
 *    event that precedes it in the same session, at most one verdict exists
 *    per asked event, and payload fields obey the closed vocabularies
 *    (decision/reason/riskLevel/outcome/fallback). The same chain holds for
 *    `autoReview/rejection` events (hard-disable rejections).
 * 2. Model-visible ⟺ logged: every `tool/result` carrying the deny marker
 *    links to a recorded `deny` verdict with a matching call id, every
 *    `tool/result` carrying the fallback marker links to a recorded fallback
 *    verdict that was rejected, and every `tool/result` carrying the never
 *    marker links to a recorded rejection that settled rejected.
 *
 * @module dsh-auto-review/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { AUTO_REVIEW_FALLBACKS, CIRCUIT_MARKER_PATTERN, DENY_MARKER_PATTERN, FALLBACK_MARKER_PATTERN, NEVER_MARKER_PATTERN } from './events.ts'

const PACKAGE_NAME = 'dsh-auto-review'

/** Cordis companion plugin name. */
export const name = 'auto-review-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

const DECISIONS: readonly string[] = ['allow', 'deny']
const RISK_LEVELS: readonly string[] = ['low', 'medium', 'high']
const OUTCOMES: readonly string[] = ['allowed-once', 'rejected', 'cancelled', 'unavailable']
const TRIP_KINDS: readonly string[] = ['consecutive', 'window']
const CIRCUIT_ACTIONS: readonly string[] = ['delegate', 'reject', 'abort-turn']

interface VerdictRecord {
  readonly callId: string | undefined
  readonly decision: string | undefined
  readonly outcome: string | undefined
  readonly fallback: string | undefined
  readonly escalation: string | undefined
}

/** One recorded hard-disable rejection, for never-marker reconstruction. */
interface RejectionRecord {
  readonly callId: string | undefined
  readonly outcome: string | undefined
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Install verdict-chain and deny-marker validation over loaded logs and newly appended events. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  // Install-scoped so a dispose/re-register cycle re-sweeps from a clean slate.
  const askedIds = new WeakMap<Session, Map<string, number>>()
  const verdicts = new WeakMap<Session, Map<string, VerdictRecord>>()
  const verdictByApproval = new WeakMap<Session, Map<string, VerdictRecord>>()
  const circuits = new WeakMap<Session, Map<string, string>>()
  const rejections = new WeakMap<Session, Map<string, RejectionRecord>>()

  const validateEvent = (session: Session, event: SessionEvent): void => {
    if (event.type === 'approval/asked') {
      let ids = askedIds.get(session)
      if (ids === undefined) {
        ids = new Map<string, number>()
        askedIds.set(session, ids)
      }
      ids.set(event.data.id, (ids.get(event.data.id) ?? 0) + 1)
      return
    }
    if (event.type === 'autoReview/verdict') {
      const data = event.data
      const fallback = data.fallback
      if (fallback === undefined) {
        if (data.decision === undefined || !DECISIONS.includes(data.decision)) {
          fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} has invalid decision ${JSON.stringify(data.decision)}`)
        }
        if (typeof data.reason !== 'string' || data.reason.length === 0) {
          fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} has no reviewer reason`)
        }
        if (data.riskLevel !== undefined && !RISK_LEVELS.includes(data.riskLevel)) {
          fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} has invalid riskLevel ${JSON.stringify(data.riskLevel)}`)
        }
      } else {
        if (!AUTO_REVIEW_FALLBACKS.includes(fallback)) {
          fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} has invalid fallback ${JSON.stringify(fallback)}`)
        }
        if (data.decision !== undefined || data.reason !== undefined || data.riskLevel !== undefined) {
          fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} carries verdict fields alongside fallback ${JSON.stringify(fallback)}`)
        }
      }
      if (data.outcome !== undefined && !OUTCOMES.includes(data.outcome)) {
        fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} has invalid outcome ${JSON.stringify(data.outcome)}`)
      }
      if (data.escalation !== undefined) {
        // The only escalation today: the risk policy overrode an allow. It
        // must reference an allow verdict and can never settle allowed-once.
        if (data.escalation !== 'risk-policy') {
          fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} has invalid escalation ${JSON.stringify(data.escalation)}`)
        }
        if (data.decision !== 'allow') {
          fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} escalates a non-allow verdict`)
        }
        if (data.outcome === 'allowed-once') {
          fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} escalates yet settles allowed-once`)
        }
      }
      if (!Number.isSafeInteger(data.durationMs) || data.durationMs < 0) {
        fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} has invalid durationMs ${String(data.durationMs)}`)
      }
      const count = askedIds.get(session)?.get(data.approvalId) ?? 0
      if (count < 1) {
        fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} references no prior approval/asked ${JSON.stringify(data.approvalId)}`)
      }
      let verdictsForSession = verdicts.get(session)
      if (verdictsForSession === undefined) {
        verdictsForSession = new Map<string, VerdictRecord>()
        verdicts.set(session, verdictsForSession)
      }
      if (verdictsForSession.has(data.reviewId)) {
        fail(`autoReview/verdict repeats reviewId ${JSON.stringify(data.reviewId)}`)
      }
      const record: VerdictRecord = {
        callId: data.callId,
        decision: data.decision,
        outcome: data.outcome,
        fallback: data.fallback,
        escalation: data.escalation,
      }
      verdictsForSession.set(data.reviewId, record)
      let byApproval = verdictByApproval.get(session)
      if (byApproval === undefined) {
        byApproval = new Map<string, VerdictRecord>()
        verdictByApproval.set(session, byApproval)
      }
      if (byApproval.has(data.approvalId)) {
        fail(`autoReview/verdict ${JSON.stringify(data.reviewId)} is the second verdict for approval/asked ${JSON.stringify(data.approvalId)}`)
      }
      byApproval.set(data.approvalId, record)
      return
    }
    if (event.type === 'autoReview/circuit') {
      const data = event.data
      if (!TRIP_KINDS.includes(data.trip.kind)) {
        fail(`autoReview/circuit ${JSON.stringify(data.circuitId)} has invalid trip kind ${JSON.stringify(data.trip.kind)}`)
      }
      if (!CIRCUIT_ACTIONS.includes(data.action)) {
        fail(`autoReview/circuit ${JSON.stringify(data.circuitId)} has invalid action ${JSON.stringify(data.action)}`)
      }
      if (!Number.isSafeInteger(data.trip.count) || data.trip.count < 1) {
        fail(`autoReview/circuit ${JSON.stringify(data.circuitId)} has invalid trip count ${String(data.trip.count)}`)
      }
      let circuitIds = circuits.get(session)
      if (circuitIds === undefined) {
        circuitIds = new Map<string, string>()
        circuits.set(session, circuitIds)
      }
      if (circuitIds.has(data.circuitId)) {
        fail(`autoReview/circuit repeats circuitId ${JSON.stringify(data.circuitId)}`)
      }
      circuitIds.set(data.circuitId, data.action)
      return
    }
    if (event.type === 'autoReview/override') {
      const verdict = verdicts.get(session)?.get(event.data.reviewId)
      if (verdict === undefined || (verdict.decision !== 'deny' && verdict.escalation !== 'risk-policy')) {
        fail(`autoReview/override references reviewId ${JSON.stringify(event.data.reviewId)} without a prior denial verdict`)
      }
      return
    }
    if (event.type === 'autoReview/rejection') {
      const data = event.data
      if (typeof data.reason !== 'string' || data.reason.length === 0) {
        fail(`autoReview/rejection ${JSON.stringify(data.rejectionId)} has no hard-disable reason`)
      }
      if (data.outcome !== 'rejected') {
        fail(`autoReview/rejection ${JSON.stringify(data.rejectionId)} has invalid outcome ${JSON.stringify(data.outcome)}`)
      }
      if (data.approvalId !== undefined) {
        const count = askedIds.get(session)?.get(data.approvalId) ?? 0
        if (count < 1) {
          fail(`autoReview/rejection ${JSON.stringify(data.rejectionId)} references no prior approval/asked ${JSON.stringify(data.approvalId)}`)
        }
        let byApproval = verdictByApproval.get(session)
        if (byApproval === undefined) {
          byApproval = new Map<string, VerdictRecord>()
          verdictByApproval.set(session, byApproval)
        }
        if (byApproval.has(data.approvalId)) {
          fail(`autoReview/rejection ${JSON.stringify(data.rejectionId)} is the second decision for approval/asked ${JSON.stringify(data.approvalId)}`)
        }
        byApproval.set(data.approvalId, {
          callId: data.callId,
          decision: undefined,
          outcome: data.outcome,
          fallback: undefined,
          escalation: undefined,
        })
      }
      let rejectionIds = rejections.get(session)
      if (rejectionIds === undefined) {
        rejectionIds = new Map<string, RejectionRecord>()
        rejections.set(session, rejectionIds)
      }
      if (rejectionIds.has(data.rejectionId)) {
        fail(`autoReview/rejection repeats rejectionId ${JSON.stringify(data.rejectionId)}`)
      }
      rejectionIds.set(data.rejectionId, { callId: data.callId, outcome: data.outcome })
      return
    }
    if (event.type === 'approval/decided') {
      // The answerer claims a request by appending its verdict BEFORE the
      // service settles the decided pair; a claimed verdict must therefore
      // agree with the recorded outcome (a `delegate` fallback omits its
      // outcome because the downstream answerer owns the decision).
      const claimed = verdictByApproval.get(session)?.get(event.data.id)
      if (claimed?.outcome !== undefined && claimed.outcome !== event.data.outcome) {
        fail(`approval/decided ${JSON.stringify(event.data.id)} outcome ${JSON.stringify(event.data.outcome)} contradicts the autoReview/verdict outcome ${JSON.stringify(claimed.outcome)}`)
      }
      return
    }
    if (event.type === 'tool/result') {
      const block = event.data.message.content[0]
      if (block === undefined || block.type !== 'tool-result') {
        // Not a tool-result projection this invariant owns; skip.
        return
      }
      const text = block.content
        .filter(item => item.type === 'text')
        .map(item => (item as { text: string }).text)
        .join('\n')
      const denyMatch = DENY_MARKER_PATTERN.exec(text)
      if (denyMatch !== null) {
        const reviewId = denyMatch[1]
        if (reviewId === undefined) {
          fail(`tool/result carries an unparseable deny marker: ${JSON.stringify(denyMatch[0])}`)
          return
        }
        const verdict = verdicts.get(session)?.get(reviewId)
        if (verdict === undefined) {
          fail(`tool/result deny marker references unknown reviewId ${JSON.stringify(reviewId)}`)
          return
        }
        if (verdict.decision !== 'deny' && !(verdict.escalation === 'risk-policy' && verdict.outcome === 'rejected')) {
          fail(`tool/result deny marker references a non-deny verdict ${JSON.stringify(reviewId)}`)
        }
        if (verdict.callId !== undefined && verdict.callId !== block.toolCallId) {
          fail(`tool/result deny marker for review ${JSON.stringify(reviewId)} has call id ${JSON.stringify(block.toolCallId)}, expected ${JSON.stringify(verdict.callId)}`)
        }
        return
      }
      const fallbackMatch = FALLBACK_MARKER_PATTERN.exec(text)
      if (fallbackMatch !== null) {
        const reviewId = fallbackMatch[1]
        if (reviewId === undefined) {
          fail(`tool/result carries an unparseable fallback marker: ${JSON.stringify(fallbackMatch[0])}`)
          return
        }
        const verdict = verdicts.get(session)?.get(reviewId)
        if (verdict === undefined) {
          fail(`tool/result fallback marker references unknown reviewId ${JSON.stringify(reviewId)}`)
          return
        }
        if (verdict.fallback === undefined || verdict.outcome !== 'rejected') {
          fail(`tool/result fallback marker references a verdict that was not rejected by fallback ${JSON.stringify(reviewId)}`)
        }
        if (verdict.callId !== undefined && verdict.callId !== block.toolCallId) {
          fail(`tool/result fallback marker for review ${JSON.stringify(reviewId)} has call id ${JSON.stringify(block.toolCallId)}, expected ${JSON.stringify(verdict.callId)}`)
        }
        return
      }
      const circuitMatch = CIRCUIT_MARKER_PATTERN.exec(text)
      if (circuitMatch !== null) {
        const circuitId = circuitMatch[1]
        const toolName = circuitMatch[2]
        if (circuitId === undefined || toolName === undefined) {
          fail(`tool/result carries an unparseable circuit marker: ${JSON.stringify(circuitMatch[0])}`)
          return
        }
        const action = circuits.get(session)?.get(circuitId)
        if (action === undefined) {
          fail(`tool/result circuit marker references unknown circuitId ${JSON.stringify(circuitId)}`)
          return
        }
        if (action === 'delegate') {
          fail(`tool/result circuit marker references a delegate-action circuit ${JSON.stringify(circuitId)}`)
        }
        return
      }
      const neverMatch = NEVER_MARKER_PATTERN.exec(text)
      if (neverMatch === null) return
      const rejectionId = neverMatch[1]
      if (rejectionId === undefined) {
        fail(`tool/result carries an unparseable never marker: ${JSON.stringify(neverMatch[0])}`)
        return
      }
      const rejection = rejections.get(session)?.get(rejectionId)
      if (rejection === undefined) {
        fail(`tool/result never marker references unknown rejectionId ${JSON.stringify(rejectionId)}`)
        return
      }
      if (rejection.outcome !== 'rejected') {
        fail(`tool/result never marker references a rejection that did not settle rejected ${JSON.stringify(rejectionId)}`)
      }
      if (rejection.callId !== undefined && rejection.callId !== block.toolCallId) {
        fail(`tool/result never marker for rejection ${JSON.stringify(rejectionId)} has call id ${JSON.stringify(block.toolCallId)}, expected ${JSON.stringify(rejection.callId)}`)
      }
    }
  }
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(session, event)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    validateEvent(session, event)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
