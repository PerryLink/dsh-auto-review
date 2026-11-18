/**
 * Session event access shared by the audit, review, invariant, and eval
 * paths. 0.1.2-alpha.5 renamed the `Session.events` getter to
 * `snapshotEvents()` while the peer floor (>=0.1.0-rc.8) still exposes
 * `.events`; the runtime probe below keeps both harness lines working
 * without tightening peers.
 * @module dsh-auto-review/session-events
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { auditEventTypeOf } from './audit.ts'

/** A session-like that only needs to expose the events these readers fold. */
export type SessionEventsSource = Session | { events?: readonly SessionEvent[] }

/**
 * Fold `plugin:dsh-auto-review/*` records back onto the `autoReview/*` names
 * every reader here was written against, so a log may carry either spelling
 * (the older one from `append`, the newer one from `appendPluginRecord`) and
 * both fold the same way. Allocation-free on logs that only use the old names.
 * @param events - the snapshot to normalize.
 * @returns the same array when no record needs renaming, else a mapped copy.
 */
function normalizePluginRecords(events: readonly SessionEvent[]): readonly SessionEvent[] {
  const first = events.findIndex((event) => auditEventTypeOf(event.type) !== event.type)
  if (first < 0) return events
  const normalized = events.slice()
  for (let i = first; i < normalized.length; i += 1) {
    const event = normalized[i] as SessionEvent
    const type = auditEventTypeOf(event.type)
    if (type !== event.type) normalized[i] = { ...event, type } as SessionEvent
  }
  return normalized
}

/**
 * The current event snapshot of one session, whichever harness line owns it.
 * @param session - the host Session (or a fixture-shaped session in tests).
 * @returns a frozen full log snapshot on alpha.5+, the `.events` array earlier.
 */
export function sessionEvents(session: SessionEventsSource | null | undefined): readonly SessionEvent[] {
  if (session === null || session === undefined) return []
  const probe = session as { snapshotEvents?: () => readonly SessionEvent[] }
  if (typeof probe.snapshotEvents === 'function') return normalizePluginRecords(probe.snapshotEvents())
  return normalizePluginRecords((session as { events?: readonly SessionEvent[] }).events ?? [])
}
