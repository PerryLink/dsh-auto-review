/**
 * Same-fingerprint verdict cache unit tests: fingerprint normalization
 * (volatile-field stripping, key-order and formatting stability, semantic-key
 * preservation, unparseable-input fallback) and the TTL/eviction/counter
 * behavior of {@link VerdictCache} (hit, expiry, disabled cache, cap).
 * @module dsh-auto-review/test/cache.spec
 */

import { describe, expect, it } from 'vitest'
import { VerdictCache, canonicalArguments, fingerprint } from '../src/index.ts'

describe('fingerprint normalization', () => {
  it('is stable across object key order', () => {
    const first = fingerprint('bash', '{"command":"ls","cwd":"/tmp"}')
    const second = fingerprint('bash', '{"cwd":"/tmp","command":"ls"}')
    expect(first).toBeDefined()
    expect(first).toBe(second)
  })

  it('is stable across JSON formatting (whitespace)', () => {
    expect(fingerprint('bash', '{ "command" : "ls" }')).toBe(fingerprint('bash', '{"command":"ls"}'))
  })

  it('strips volatile fields (timestamp, request id, nonce)', () => {
    expect(fingerprint('bash', '{"command":"ls","timestamp":123}'))
      .toBe(fingerprint('bash', '{"command":"ls","timestamp":999}'))
    expect(fingerprint('bash', '{"command":"ls","requestId":"r1"}'))
      .toBe(fingerprint('bash', '{"command":"ls","requestId":"r2"}'))
    expect(fingerprint('bash', '{"command":"ls","nonce":"n1"}'))
      .toBe(fingerprint('bash', '{"command":"ls","nonce":"n2"}'))
  })

  it('keeps semantic target keys in the fingerprint (no over-stripping)', () => {
    // `id` names the action's target, not transient metadata: two different
    // ids must NOT collapse into one verdict.
    expect(fingerprint('bash', '{"command":"rm","id":"a"}'))
      .not.toBe(fingerprint('bash', '{"command":"rm","id":"b"}'))
  })

  it('treats different tools or arguments as distinct fingerprints', () => {
    expect(fingerprint('bash', '{"command":"ls"}')).not.toBe(fingerprint('write', '{"command":"ls"}'))
    expect(fingerprint('bash', '{"command":"ls"}')).not.toBe(fingerprint('bash', '{"command":"rm"}'))
  })

  it('returns undefined for missing or unparseable arguments (fail-closed → second model)', () => {
    expect(fingerprint('bash', undefined)).toBeUndefined()
    expect(fingerprint('bash', '{not json')).toBeUndefined()
  })

  it('produces a hex digest, never the plaintext arguments', () => {
    const digest = fingerprint('bash', '{"command":"curl","token":"secret-token"}')
    expect(digest).toMatch(/^[0-9a-f]{64}$/u)
    expect(digest).not.toContain('secret-token')
    expect(digest).not.toContain('curl')
  })
})

describe('canonicalArguments', () => {
  it('sorts nested object keys and strips volatile fields', () => {
    expect(canonicalArguments({ b: { y: 1, x: 2 }, a: 1, timestamp: 3 }))
      .toBe('{"a":1,"b":{"x":2,"y":1}}')
  })
})

describe('VerdictCache', () => {
  const verdict = { decision: 'allow' as const, reason: 'ok' }

  it('replays a verdict within the TTL and misses after expiry', () => {
    const cache = new VerdictCache({ ttlMs: 1000, maxEntries: 16 })
    cache.set('fp', verdict, 0)
    expect(cache.get('fp', 500)).toEqual(verdict)
    expect(cache.get('fp', 1001)).toBeUndefined()
    expect(cache.get('fp', 1001)).toBeUndefined()
  })

  it('is disabled when ttlMs is 0 (set is a no-op, get always misses)', () => {
    const cache = new VerdictCache({ ttlMs: 0, maxEntries: 16 })
    cache.set('fp', verdict, 0)
    expect(cache.get('fp', 0)).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('evicts the oldest entry beyond maxEntries', () => {
    const cache = new VerdictCache({ ttlMs: 1000, maxEntries: 2 })
    cache.set('a', verdict, 0)
    cache.set('b', verdict, 1)
    cache.set('c', verdict, 2)
    expect(cache.get('a', 2)).toBeUndefined()
    expect(cache.get('b', 2)).toEqual(verdict)
    expect(cache.get('c', 2)).toEqual(verdict)
    expect(cache.size).toBe(2)
  })

  it('counts hits and stores', () => {
    const cache = new VerdictCache({ ttlMs: 1000, maxEntries: 16 })
    cache.set('fp', verdict, 0)
    cache.get('fp', 1)
    cache.get('missing', 1)
    expect(cache.hits).toBe(1)
    expect(cache.stores).toBe(1)
  })

  it('clears entries and resets counters', () => {
    const cache = new VerdictCache({ ttlMs: 1000, maxEntries: 16 })
    cache.set('fp', verdict, 0)
    cache.get('fp', 1)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.hits).toBe(0)
    expect(cache.stores).toBe(0)
    expect(cache.get('fp', 2)).toBeUndefined()
  })
})
