/**
 * Session event access shared by the audit, review, invariant, and eval
 * paths. 0.1.2-alpha.5 renamed the `Session.events` getter to
 * `snapshotEvents()` while the peer floor (>=0.1.0-rc.8) still exposes
 * `.events`; the runtime probe below keeps both harness lines working
 * without tightening peers.
 * @module dsh-auto-review/session-events
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** A session-like that only needs to expose the events these readers fold. */
export type SessionEventsSource = Session | { events?: readonly SessionEvent[] }

/**
 * The current event snapshot of one session, whichever harness line owns it.
 * @param session - the host Session (or a fixture-shaped session in tests).
 * @returns a frozen full log snapshot on alpha.5+, the `.events` array earlier.
 */
export function sessionEvents(session: SessionEventsSource | null | undefined): readonly SessionEvent[] {
  if (session === null || session === undefined) return []
  const probe = session as { snapshotEvents?: () => readonly SessionEvent[] }
  if (typeof probe.snapshotEvents === 'function') return probe.snapshotEvents()
  return (session as { events?: readonly SessionEvent[] }).events ?? []
}
