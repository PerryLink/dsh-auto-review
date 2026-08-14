/**
 * Pure-type outlet of the `autoReview` session projection: the wire value
 * the host folds and the browser review panel renders. Zero value imports —
 * client programs pull these types without dragging the host chain.
 * @module dsh-auto-review/projection-types
 */

/** One verdict, presented for the panel. */
export interface AutoReviewVerdictView {
  readonly reviewId: string
  readonly toolName: string
  readonly at: number
  readonly durationMs: number
  readonly decision?: 'allow' | 'deny'
  readonly riskLevel?: 'low' | 'medium' | 'high'
  readonly escalation?: 'risk-policy'
  readonly fallback?: string
  readonly outcome?: string
  readonly reason?: string
}

/** One recent denial offered for a one-shot approve (newest first). */
export interface AutoReviewDenyView {
  readonly reviewId: string
  readonly toolName: string
  readonly reason?: string
}

/** The whole wire value folded by the `autoReview` projection unit. */
export interface AutoReviewProjection {
  /** The session's switch — the last `autoReview/state` event, or the `enableByDefault` default. */
  readonly enabled: boolean
  /** Real AI verdicts in the current open turn. */
  readonly verdictsUsed: number
  /** Reviewer failures in the current open turn. */
  readonly failuresUsed: number
  /** Cumulative counts over the whole session. */
  readonly allows: number
  readonly denies: number
  readonly fallbacks: number
  /** Mean duration of decision-carrying verdicts, rounded; 0 without any. */
  readonly avgDurationMs: number
  /** The current turn's circuit trip, or null. */
  readonly circuit: {
    readonly action: 'delegate' | 'reject' | 'abort-turn'
    readonly trip: { readonly kind: 'consecutive' | 'window'; readonly count: number }
    readonly toolName: string
  } | null
  /** The last 8 verdicts, newest first. */
  readonly recent: readonly AutoReviewVerdictView[]
  /** The last 5 denials, newest first (approve candidates; index 0 = approve 1). */
  readonly recentDenies: readonly AutoReviewDenyView[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    autoReview: AutoReviewProjection
  }
}
