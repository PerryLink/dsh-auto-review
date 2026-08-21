/**
 * Host-capability detection unit tests: the `ignorable` envelope-marker
 * probe helpers every audit path gates on.
 * @module dsh-auto-review/test/audit.spec
 */

import { describe, expect, it } from 'vitest'
import { isMarkedAuditEvent, isUnmarkedHostVersion, peerSessionVersion } from '../src/audit.ts'

describe('isUnmarkedHostVersion', () => {
  it('flags the known-unmarked rc.1–rc.8 lines (no release stamps the marker yet)', () => {
    for (const version of ['0.1.0-rc.1', '0.1.0-rc.2', '0.1.0-rc.5', '0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8', ' 0.1.0-rc.8 ']) {
      expect(isUnmarkedHostVersion(version)).toBe(true)
    }
  })

  it('treats later and non-rc versions as possibly-marker-aware (verified by the probe)', () => {
    for (const version of ['0.1.0-rc.9', '0.2.0', '0.1.0', '1.0.0', '0.1.0-rc.8-nightly']) {
      expect(isUnmarkedHostVersion(version)).toBe(false)
    }
  })

  it('rejects garbage without throwing', () => {
    expect(isUnmarkedHostVersion('')).toBe(false)
    expect(isUnmarkedHostVersion('not-a-version')).toBe(false)
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
