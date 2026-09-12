/**
 * Host-capability detection unit tests: the `ignorable` envelope-marker
 * probe helpers every audit path gates on.
 * @module dsh-auto-review/test/audit.spec
 */

import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { isMarkedAuditEvent, isUnmarkedHostVersion, peerSessionVersion } from '../src/audit.ts'

describe('isUnmarkedHostVersion', () => {
  it('flags the known-unmarked rc lines, the fail-closed master line, and the dual-line alpha', () => {
    for (const version of ['0.1.0-rc.1', '0.1.0-rc.2', '0.1.0-rc.5', '0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8', ' 0.1.0-rc.8 ', '0.1.1-rc.1', '0.1.1-rc.2', '0.1.2-alpha.1', '0.1.2', '0.1.3-beta.1', '0.1.2-rc.1', '0.1.3-alpha.2', '0.1.5-alpha.1']) {
      expect(isUnmarkedHostVersion(version)).toBe(true)
    }
  })

  // Regression pin for the 2026-09-12 investigation: every one of these is a
  // version published to npm (verified by unpacking each tarball and reading
  // its built append body), and NOT ONE of them can write the ignorable
  // marker. A `true` here is the accurate classification, so this test exists
  // to stop a future "narrow the bound" change from turning the guard into the
  // exact log pollution it was written to prevent. If a host ever adds the
  // append option, this test should fail and the classifier should be
  // revisited deliberately — not silently widened.
  it('flags every published 0.1.x line, including the current 0.1.5-rc.2', () => {
    const published = [
      '0.1.0-rc.1', '0.1.0-rc.2', '0.1.0-rc.3', '0.1.0-rc.5', '0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8',
      '0.1.1-rc.1', '0.1.1-rc.2',
      '0.1.2-alpha.1', '0.1.2-alpha.2', '0.1.2-alpha.3', '0.1.2-alpha.4', '0.1.2-alpha.5', '0.1.2-rc.1',
      '0.1.3-alpha.2',
      '0.1.5-alpha.1', '0.1.5-rc.1', '0.1.5-rc.2',
    ]
    for (const version of published) {
      expect(isUnmarkedHostVersion(version), `${version} must classify as unmarked`).toBe(true)
    }
  })

  it('treats later and non-rc versions as possibly-marker-aware (verified by the probe)', () => {
    for (const version of ['0.1.0-rc.9', '0.1.1-rc.3', '0.2.0', '0.1.0', '1.0.0', '0.1.0-rc.8-nightly']) {
      expect(isUnmarkedHostVersion(version)).toBe(false)
    }
  })

  it('rejects garbage without throwing', () => {
    expect(isUnmarkedHostVersion('')).toBe(false)
    expect(isUnmarkedHostVersion('not-a-version')).toBe(false)
  })
})

// Canary over the real host, not a stub: it pins the fact the whole
// detect-and-degrade design rests on. `append`'s optional third parameter is
// `SurfaceIntent` (surface event types only), so passing `{ ignorable: true }`
// is silently dropped and the returned envelope never carries the marker. If
// the installed peer ever starts honoring it, the probe path becomes reachable
// and this test tells us to revisit `isUnmarkedHostVersion` on purpose.
describe('host append cannot stamp the ignorable marker', () => {
  it('drops the marker from an out-of-tree append on the installed peer', () => {
    const session = Session.create(SessionId('audit-spec-marker-probe'))
    const returned = (session.append as unknown as (
      type: string, data: Record<string, unknown>, opts?: { ignorable?: true },
    ) => Record<string, unknown>).call(
      session, 'autoReview/verdict', { reviewId: 'spec', decision: 'allow', reason: 'spec', riskLevel: 'low' }, { ignorable: true },
    )
    expect(Object.keys(returned).sort()).toEqual(['data', 'seq', 'time', 'type'])
    expect(returned['ignorable']).toBeUndefined()
    expect(isMarkedAuditEvent(returned)).toBe(false)
  })
})

describe('isMarkedAuditEvent', () => {
  it('accepts only an envelope carrying ignorable === true', () => {
    expect(isMarkedAuditEvent({ ignorable: true })).toBe(true)
    expect(isMarkedAuditEvent({ ignorable: false })).toBe(false)
    expect(isMarkedAuditEvent({})).toBe(false)
    expect(isMarkedAuditEvent(null)).toBe(false)
    expect(isMarkedAuditEvent(undefined)).toBe(false)
    expect(isMarkedAuditEvent('event')).toBe(false)
  })
})

describe('peerSessionVersion', () => {
  it('resolves the installed peer version string', () => {
    const version = peerSessionVersion()
    expect(typeof version).toBe('string')
    expect(version).toMatch(/^\d+\.\d+\.\d+/u)
  })
})
