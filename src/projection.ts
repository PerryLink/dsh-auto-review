/**
 * Host projection unit for the `autoReview` panel value: folds the log-only
 * `autoReview/*` events into one wire-JSON whole value the browser review
 * panel reads via `useProjection('autoReview')`. Pure mathematics only — the
 * framework owns subscriptions, watermarks, change feeds, and persistence.
 * The fold mirrors the `events.ts` pure folds (budgets, statistics, denials).
 * @module dsh-auto-review/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import type { AutoReviewDenyView, AutoReviewProjection, AutoReviewProjectionState, AutoReviewVerdictView } from './projection-types.ts'

/** How many verdict rows the panel carries. */
const RECENT_CAP = 8
/** How many approve candidates the panel offers. */
const DENIES_CAP = 5

const VERDICT_VIEW_SCHEMA = z.object({
  reviewId: z.string(),
  toolName: z.string(),
  at: z.number(),
  durationMs: z.number().int().nonnegative(),
  decision: z.union([z.literal('allow'), z.literal('deny')]).optional(),
  riskLevel: z.union([z.literal('low'), z.literal('medium'), z.literal('high')]).optional(),
  escalation: z.literal('risk-policy').optional(),
  fallback: z.string().optional(),
  outcome: z.union([z.literal('allowed-once'), z.literal('rejected'), z.literal('cancelled'), z.literal('unavailable')]).optional(),
  reason: z.string().optional(),
})

const DENY_VIEW_SCHEMA = z.object({
  reviewId: z.string(),
  toolName: z.string(),
  reason: z.string().optional(),
})

const CIRCUIT_VIEW_SCHEMA = z.object({
  action: z.union([z.literal('delegate'), z.literal('reject'), z.literal('abort-turn')]),
  trip: z.object({
    kind: z.union([z.literal('consecutive'), z.literal('window')]),
    count: z.number().int().positive(),
  }),
  toolName: z.string(),
}).nullable()

/** Strict wire schema — validates the `view` output before it leaves the host. */
export const AUTO_REVIEW_PROJECTION_SCHEMA = z.object({
  enabled: z.boolean(),
  verdictsUsed: z.number().int().nonnegative(),
  failuresUsed: z.number().int().nonnegative(),
  allows: z.number().int().nonnegative(),
  denies: z.number().int().nonnegative(),
  fallbacks: z.number().int().nonnegative(),
  neverRejects: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  avgDurationMs: z.number().int().nonnegative(),
  circuit: CIRCUIT_VIEW_SCHEMA,
  recent: z.array(VERDICT_VIEW_SCHEMA),
  recentDenies: z.array(DENY_VIEW_SCHEMA),
})

/** Drop `readonly` from a view type so a fold can fill optional fields conditionally. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

/**
 * State for the empty log. `enabled` starts at the resolved
 * `enableByDefault` — the projection cannot know the plugin config on its
 * own, so the unit is built per mount by {@link makeAutoReviewProjection}.
 * @param enabledByDefault - the resolved `enableByDefault` config value.
 */
export function initAutoReviewProjection(enabledByDefault: boolean): AutoReviewProjectionState {
  return {
    enabled: enabledByDefault,
    turnOpen: false,
    verdictsUsed: 0,
    failuresUsed: 0,
    allows: 0,
    denies: 0,
    fallbacks: 0,
    neverRejects: 0,
    cacheHits: 0,
    durationSum: 0,
    decided: 0,
    circuit: null,
    recent: [],
    recentDenies: [],
  }
}

/** One verdict event as its panel row. */
function verdictView(data: SessionEventMap['autoReview/verdict'], at: number): AutoReviewVerdictView {
  const view: Mutable<AutoReviewVerdictView> = {
    reviewId: String(data.reviewId),
    toolName: data.toolName,
    at,
    durationMs: data.durationMs,
  }
  if (data.decision !== undefined) view.decision = data.decision
  if (data.riskLevel !== undefined) view.riskLevel = data.riskLevel
  if (data.escalation !== undefined) view.escalation = data.escalation
  if (data.fallback !== undefined) view.fallback = data.fallback
  if (data.outcome !== undefined) view.outcome = data.outcome
  if (data.reason !== undefined) view.reason = data.reason
  return view
}

/** One denial event as its approve row. */
function denyView(data: SessionEventMap['autoReview/verdict']): AutoReviewDenyView {
  const view: Mutable<AutoReviewDenyView> = {
    reviewId: String(data.reviewId),
    toolName: data.toolName,
  }
  if (data.reason !== undefined) view.reason = data.reason
  return view
}

/**
 * Pure transition: previous state + one committed event → next state.
 * Uninterested events return the same state reference.
 * @param state - the state covering all prior events.
 * @param event - the next committed session event.
 * @returns the next state (same reference when the event is not this unit's).
 */
export function applyAutoReview(state: AutoReviewProjectionState, event: SessionEvent): AutoReviewProjectionState {
  switch (event.type) {
    case 'turn/start':
      return state.turnOpen
        ? state
        : { ...state, turnOpen: true, verdictsUsed: 0, failuresUsed: 0, circuit: null }
    case 'turn/end':
      return state.turnOpen ? { ...state, turnOpen: false } : state
    case 'autoReview/state':
      return state.enabled === event.data.enabled ? state : { ...state, enabled: event.data.enabled }
    case 'autoReview/circuit':
      return {
        ...state,
        circuit: { action: event.data.action, trip: event.data.trip, toolName: event.data.toolName },
      }
    case 'autoReview/rejection':
      return { ...state, neverRejects: state.neverRejects + 1 }
    case 'autoReview/verdict': {
      const data = event.data
      const decision = data.decision !== undefined
      const failure = data.fallback !== undefined && data.fallback !== 'cancelled'
      const denial = data.decision === 'deny' || data.escalation === 'risk-policy'
      const row = verdictView(data, event.time)
      return {
        ...state,
        verdictsUsed: state.turnOpen && decision ? state.verdictsUsed + 1 : state.verdictsUsed,
        failuresUsed: state.turnOpen && failure ? state.failuresUsed + 1 : state.failuresUsed,
        allows: state.allows + (data.decision === 'allow' ? 1 : 0),
        denies: state.denies + (data.decision === 'deny' ? 1 : 0),
        fallbacks: state.fallbacks + (decision ? 0 : 1),
        cacheHits: state.cacheHits + (data.cached === true ? 1 : 0),
        durationSum: state.durationSum + (decision ? data.durationMs : 0),
        decided: state.decided + (decision ? 1 : 0),
        recent: [row, ...state.recent].slice(0, RECENT_CAP),
        recentDenies: denial
          ? [denyView(data), ...state.recentDenies].slice(0, DENIES_CAP)
          : state.recentDenies,
      }
    }
    default:
      return state
  }
}

/** State → wire payload (the read-side projection). */
export function viewAutoReview(state: AutoReviewProjectionState): AutoReviewProjection {
  return {
    enabled: state.enabled,
    verdictsUsed: state.verdictsUsed,
    failuresUsed: state.failuresUsed,
    allows: state.allows,
    denies: state.denies,
    fallbacks: state.fallbacks,
    neverRejects: state.neverRejects,
    cacheHits: state.cacheHits,
    avgDurationMs: state.decided === 0 ? 0 : Math.round(state.durationSum / state.decided),
    circuit: state.circuit,
    recent: state.recent,
    recentDenies: state.recentDenies,
  }
}

/** Strict state schema — validates the persisted fold state before it seeds a fold. */
export const AUTO_REVIEW_STATE_SCHEMA = z.object({
  enabled: z.boolean(),
  turnOpen: z.boolean(),
  verdictsUsed: z.number().int().nonnegative(),
  failuresUsed: z.number().int().nonnegative(),
  allows: z.number().int().nonnegative(),
  denies: z.number().int().nonnegative(),
  fallbacks: z.number().int().nonnegative(),
  neverRejects: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  durationSum: z.number().int().nonnegative(),
  decided: z.number().int().nonnegative(),
  circuit: CIRCUIT_VIEW_SCHEMA,
  recent: z.array(VERDICT_VIEW_SCHEMA),
  recentDenies: z.array(DENY_VIEW_SCHEMA),
})

/**
 * The register-ready client-visible unit shape: the rc2 `register` overload
 * requires `wire` to be PRESENT for a `SessionProjectionMap` key (the plain
 * `ProjectionDefinition` keeps `wire` optional for host-only units).
 */
type AutoReviewProjectionUnit = Omit<ProjectionDefinition<'autoReview', AutoReviewProjectionState>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<'autoReview', AutoReviewProjectionState>['wire']>
}

/**
 * Build the registered unit for one mount. The unit's initial `enabled` is
 * the mount's resolved `enableByDefault` (the pure `init` cannot see plugin
 * config otherwise), and the panel therefore reports the same switch state
 * the answerer applies. Registrants sharing the `autoReview` key share one
 * unit; the first mount's default wins, which only matters for a double
 * mount with conflicting `enableByDefault` values.
 * @param enabledByDefault - the resolved `enableByDefault` config value.
 * @returns the projection unit for `ctx.sessionProjections.register`.
 */
export function makeAutoReviewProjection(enabledByDefault: boolean): AutoReviewProjectionUnit {
  return {
    key: 'autoReview',
    // zod v4's `.optional()` output carries `| undefined`, which exact-optional
    // property types reject; the runtime validation is what matters on the wire.
    stateSchema: AUTO_REVIEW_STATE_SCHEMA as unknown as ProjectionDefinition<'autoReview', AutoReviewProjectionState>['stateSchema'],
    init: () => initAutoReviewProjection(enabledByDefault),
    apply: applyAutoReview,
    wire: {
      viewSchema: AUTO_REVIEW_PROJECTION_SCHEMA as unknown as NonNullable<ProjectionDefinition<'autoReview', AutoReviewProjectionState>['wire']>['viewSchema'],
      view: viewAutoReview,
    },
    // v3: the wire gained the cumulative `cacheHits` counter (same-fingerprint
    // verdict cache replays).
    stateVersion: 3,
  }
}
