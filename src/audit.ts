/**
 * Host-capability detection for the `ignorable` audit-envelope marker.
 *
 * `Session.append(type, data, { ignorable: true })` stamps the envelope
 * marker on host builds that expose the surface (post-rc.6
 * `@deepseek-ai/dsh-session`); the `0.1.0-rc.6` line silently drops the
 * options bag, so audit events land unmarked and stricter hosts refuse to
 * resume those sessions (`SessionFormatUnsupportedError`). The runtime
 * detects the host before polluting a log: the installed peer version is
 * checked against the known-unmarked lines first, and an unknown
 * (unresolvable) version is verified by probing the FIRST appended
 * event's returned envelope. The same discipline lives in
 * `dsh-permission-rules` (its `AuditAppend` / `isMarkedAuditEvent` pair).
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
 * Whether a `@deepseek-ai/dsh-session` version line predates the
 * `ignorable` envelope-marker surface: the `0.1.0-rc.6` line and earlier
 * silently drop the marker from `Session.append` options, so audit events
 * written by those builds land unmarked and break resume on stricter
 * hosts. Non-matching (post-rc.6, stable, or unresolvable) versions are
 * treated as possibly-marker-aware and verified by the append probe.
 * @param version - the installed peer version string.
 * @returns true for the known-unmarked rc.1–rc.6 lines.
 */
export function isUnmarkedHostVersion(version: string): boolean {
  const match = /^0\.1\.0-rc\.(\d+)$/.exec(version.trim())
  if (match === null) return false
  return Number(match[1]) <= 6
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
