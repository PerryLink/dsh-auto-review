/**
 * Host-capability detection for the `ignorable` audit-envelope marker.
 *
 * `Session.append(type, data, { ignorable: true })` stamps the envelope
 * marker on host builds that expose the surface (post-rc.6
 * `@deepseek-ai/dsh-session`); the `0.1.0-rc.6` line silently drops the
 * options bag, so audit events land unmarked and stricter hosts refuse to
 * resume those sessions (`SessionFormatUnsupportedError`). Host master
 * `0.1.2-alpha.2` keeps the `ignorable` field on the event envelope but
 * offers no append option to write it — the third parameter is
 * `SurfaceIntent`, accepted only for surface event types — so `append`
 * never stamps the marker there either. The runtime detects the host
 * before polluting a log: the installed peer version is checked against
 * the known-unmarked lines first, and an unknown (unresolvable) version is
 * verified by probing the FIRST appended event's returned envelope. The
 * same discipline lives in `dsh-permission-rules` (its `AuditAppend` /
 * `isMarkedAuditEvent` pair).
 * @module dsh-auto-review/audit
 */

import { createRequire } from 'node:module'

/** Host audit-envelope capability: unknown until the first append (or the peer-version pre-check). */
export type AuditSupport = 'unknown' | 'supported' | 'unsupported'

/**
 * Whether an `append` call actually honored the `ignorable` marker: the
 * logged event returned by the host carries `ignorable === true` on
 * marker-aware builds and nothing on pre-marker builds. `false` (or any
 * non-event return) means the host dropped the marker and the event landed
 * unmarked — the runtime then degrades instead of polluting further logs.
 * @param result - the return value of the audit append.
 * @returns true only when the marker is present on the returned envelope.
 */
export function isMarkedAuditEvent(result: unknown): boolean {
  return typeof result === 'object' && result !== null && (result as { ignorable?: unknown }).ignorable === true
}

/**
 * Whether a `@deepseek-ai/dsh-session` version line lacks a safe audit
 * write path: every released rc line through `0.1.1-rc.2` silently drops
 * the marker from `Session.append` options (no release ever stamps it),
 * and host master `0.1.2-alpha.2` keeps the `ignorable` field on the
 * event envelope but has no append option that writes it (the third
 * parameter is `SurfaceIntent` for surface event types only), so writing
 * on those lines still lands an unmarked event. The persistence read path
 * fails closed on unmarked unknown event types (`autoReview/*` is not in
 * `KNOWN_SESSION_EVENT_TYPES`), so writing there makes sessions
 * unresumable. Extend the bound when a new line ships that still cannot
 * stamp the marker. Non-matching (later rc, stable 0.2+, or unresolvable)
 * versions are treated as possibly-marker-aware and verified by the append
 * probe.
 * @param version - the installed peer version string.
 * @returns true for the known-unmarked `0.1.0-rc.1–rc.8`, `0.1.1-rc.1–rc.2`,
 *   and `0.1.2-alpha.1`+ non-stamping lines.
 */
export function isUnmarkedHostVersion(version: string): boolean {
  const v = version.trim()
  const rc = /^0\.1\.(\d+)-rc\.(\d+)$/.exec(v)
  if (rc !== null) {
    const minor = Number(rc[1])
    const patch = Number(rc[2])
    return (minor === 0 && patch <= 8) || (minor === 1 && patch <= 2)
  }
  const line = /^0\.1\.(\d+)(?:-.*)?$/.exec(v)
  if (line !== null) return Number(line[1]) >= 2
  return false
}

/**
 * The installed `@deepseek-ai/dsh-session` version, or `null` when
 * unresolvable (falls back to the append probe).
 * @returns the version string, or null when the peer cannot be resolved.
 */
export function peerSessionVersion(): string | null {
  try {
    const pkg = createRequire(import.meta.url)('@deepseek-ai/dsh-session/package.json') as { version?: unknown }
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}
