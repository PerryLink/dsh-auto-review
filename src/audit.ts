/**
 * Host-capability detection for the `ignorable` audit-envelope marker.
 *
 * **No published `@deepseek-ai/dsh-session` can stamp the `ignorable`
 * envelope marker through `append`** — verified three ways on 2026-09-12:
 * the host source (`packages/core/session/src/index.ts:710-738`: the
 * optional third parameter is `SurfaceIntent`, accepted for surface event
 * types only, and the envelope is built from `{ type, seq, time, data }`
 * plus `surfaceOp`/`sourceEventSeqs` alone); every relevant published
 * tarball (`0.1.0-rc.2/3/6/7/8`, `0.1.1-rc.1/2`, `0.1.2-alpha.2–alpha.5`,
 * `0.1.2-rc.1`, `0.1.3-alpha.2`, `0.1.5-rc.1`, `0.1.5-rc.2` — all build the
 * same envelope); and a live run against the host's own built `Session` on
 * the `0.1.5-rc.2` line, where `append('autoReview/verdict', data,
 * { ignorable: true })` returns an envelope whose keys are exactly
 * `["type","seq","time","data"]`. The marker is reachable only through the
 * seed/restore path, i.e. it is written by the harness that OWNS the log,
 * never by the plugin appending to it (`known-event-types.ts:8-20`).
 *
 * Consequence: an out-of-tree `autoReview/*` event appended on ANY published
 * host lands unmarked, and the persistence read path refuses unknown
 * unmarked types (`session-persistence/src/storage-contract.ts:75`, reached
 * from `session-persistence-jsonl/src/index.ts:627,758`), which makes the
 * session unresumable. The runtime therefore detects the host BEFORE
 * polluting a log: the installed peer version is checked against the
 * known-unmarked lines first, and an unrecognized version is verified by
 * probing the FIRST appended event's returned envelope (that probe is for a
 * FUTURE line that adds the append option — none has shipped). The
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
 * write path. **Every published line lacks one**: no release ever stamps
 * the marker from `Session.append` options (see the module docstring), so
 * a `true` result here is the accurate classification for the whole
 * published 0.1.x range and not an over-reach — do not narrow the bound to
 * "fix" it. The `0.1.6+`/`0.2+` boundary below stays permissive in the
 * other direction on purpose: a future line that adds the append option
 * must be allowed through to the probe. Writing on a `true` line still
 * lands an unmarked event. The persistence read path
 * fails closed on unmarked unknown event types (`autoReview/*` is not in
 * `KNOWN_SESSION_EVENT_TYPES` on any published line), so writing there makes
 * sessions unresumable. Extend the bound when a new line ships that still
 * cannot stamp the marker. Non-matching (later rc, stable 0.2+, or
 * unresolvable) versions are treated as possibly-marker-aware and verified
 * by the append probe.
 * @param version - the installed peer version string.
 * @returns true for every published line — the `0.1.0-rc.1–rc.8` and
 *   `0.1.1-rc.1–rc.2` rc lines, `0.1.2-alpha.1` through the published
 *   `0.1.2-rc.1`, `0.1.3-alpha.2`, and the `0.1.5-alpha.1`/`0.1.5-rc.1`/
 *   `0.1.5-rc.2` line (every one of them assembles the append envelope
 *   without the marker).
 */
export function isUnmarkedHostVersion(version: string): boolean {
  const v = version.trim()
  const rc = /^0\.1\.(\d+)-rc\.(\d+)$/.exec(v)
  if (rc !== null) {
    const minor = Number(rc[1])
    const patch = Number(rc[2])
    // `0.1.2-rc.1` ships the alpha.5 surface: the third append parameter is
    // `SurfaceIntent` for surface event types only, so no rc line in the
    // 0.1.2 minor stamps the marker either. `0.1.3-alpha.2` ships the v2
    // session format (SESSION_FORMAT_VERSION 2, assistant streams embedded)
    // and `0.1.5-alpha.1` ships v3 (the system prompt moved into the message
    // history as surface node zero); both still assemble the envelope
    // without `ignorable` — `Session.append`'s third parameter stays
    // `SurfaceIntent` for surface event types only — so the 0.1.3+ line is
    // non-stamping too (verified against each published tarball, and against
    // `0.1.5-rc.2` by a live append on 2026-09-12). `minor >= 2` therefore
    // classifies every published 0.1.x line correctly by construction; the
    // earlier reading that treated it as an over-reach was wrong.
    return (minor === 0 && patch <= 8) || (minor === 1 && patch <= 2) || minor >= 2
  }
  const line = /^0\.1\.(\d+)(?:-.*)?$/.exec(v)
  // The whole published 0.1.3+ line is non-stamping for the same reason; a
  // stable `0.1.x` cannot be distinguished from its prereleases here, and
  // fail-closed is the safe direction.
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
