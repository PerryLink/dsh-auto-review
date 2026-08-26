/**
 * Same-fingerprint verdict cache for `dsh-auto-review`: reuses a recent
 * reviewer verdict (`{decision, reason, riskLevel}`) for an identical,
 * normalized `tool + arguments` fingerprint within a TTL, so a repeated
 * action does not pay a second-model round-trip. Independent pure module —
 * it never reads the circuit breaker, the risk rules, the reviewer prompt,
 * or the session log; the runtime decides when a verdict is cacheable and
 * what a hit settles as.
 *
 * The fingerprint is a SHA-256 digest of `toolName` and the CANONICALIZED
 * call arguments. Only the digest is stored — plaintext arguments (which may
 * be sensitive) never enter the cache. Normalization strips volatile fields
 * (timestamps, request/correlation ids, nonces, …) and sorts object keys, so
 * argument ORDER and FORMATTING differences do not split what is semantically
 * the same action. Keys that name a semantic target (`id`, `callId`,
 * `sessionId`, …) are deliberately NOT volatile: stripping them would
 * collapse distinct actions into one verdict.
 * @module dsh-auto-review/cache
 */

import { createHash } from 'node:crypto'
import type { RiskLevel } from './config.ts'

/** The verdict a cache entry replays — exactly the reviewer's closed decision vocabulary. */
export interface CachedVerdict {
  readonly decision: 'allow' | 'deny'
  readonly reason: string
  readonly riskLevel?: RiskLevel
}

/**
 * Volatile argument keys, normalized (lowercased, `_`/`-` removed) before
 * matching: transient per-request metadata that would split the fingerprint
 * for an otherwise identical action. Semantic target keys are deliberately
 * absent — a fingerprint must not collapse two different actions.
 */
const VOLATILE_KEYS = new Set<string>([
  // time / date ephemera
  'timestamp', 'time', 'ts', 'epoch', 'now', 'datetime', 'date',
  'createdat', 'updatedat', 'expiresat',
  // request / observability identifiers
  'requestid', 'reqid', 'correlationid', 'traceid', 'spanid', 'runid',
  // randomness / uniqueness ephemera
  'nonce', 'random', 'jitter', 'salt', 'seed', 'uuid', 'guid',
])

/** Lowercase a key and strip word separators for the volatile set lookup. */
function normalizeKey(key: string): string {
  return key.replace(/[_\-\s]/gu, '').toLowerCase()
}

/**
 * Recursively canonicalize a parsed JSON value: strip volatile keys, sort
 * object keys, and recurse. Returns a plain JSON value whose `JSON.stringify`
 * is deterministic for the same semantic arguments regardless of key order
 * or input formatting.
 * @param value - the parsed (JSON-safe) value to canonicalize.
 * @returns the canonicalized JSON-safe value.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => canonicalize(item))
  if (typeof value === 'object' && value !== null) {
    const entries: Array<[string, unknown]> = []
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(normalizeKey(key))) continue
      entries.push([key, canonicalize(item)])
    }
    entries.sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)
    const result: Record<string, unknown> = {}
    for (const [key, item] of entries) result[key] = item
    return result
  }
  return value
}

/**
 * Canonical JSON text of an argument value: volatile keys removed, object
 * keys sorted. Formatting- and order-stable.
 * @param value - any parsed (JSON-safe) argument value.
 * @returns the canonical JSON string.
 */
export function canonicalArguments(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

/**
 * The same-fingerprint verdict cache key: SHA-256 of `toolName` and the
 * canonicalized arguments. Only the digest is produced — no plaintext
 * argument survives this function.
 * @param toolName - the pending tool call's name.
 * @param rawArguments - the presented call arguments as raw JSON text, or
 *   undefined when the log lacks them.
 * @returns the hex digest, or undefined when the arguments are absent or
 *   unparseable (the caller must then skip the cache, preserving fail-closed).
 */
export function fingerprint(toolName: string, rawArguments: string | undefined): string | undefined {
  if (rawArguments === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArguments) as unknown
  } catch {
    return undefined
  }
  let canonical: string
  try {
    canonical = canonicalArguments(parsed)
  } catch {
    return undefined
  }
  return createHash('sha256').update(`${toolName}\u0000${canonical}`, 'utf8').digest('hex')
}

/** Construction parameters for a {@link VerdictCache}. */
export interface VerdictCacheOptions {
  /** Reuse window in milliseconds; `0` disables the cache entirely. */
  readonly ttlMs: number
  /** Hard cap on cached fingerprints; the oldest entry is evicted beyond it. */
  readonly maxEntries: number
}

/**
 * A process-local, TTL-bounded map from verdict fingerprint to verdict. It
 * owns only expiration and eviction — no verdict semantics, no circuit or
 * risk logic. Reads count hits, writes count stores, both exposed for the
 * panel and tests.
 */
export class VerdictCache {
  private readonly entries = new Map<string, { verdict: CachedVerdict; at: number }>()
  private hitCount = 0
  private storeCount = 0

  constructor(private readonly options: VerdictCacheOptions) {}

  /**
   * Look up an unexpired verdict for a fingerprint.
   * @param fingerprint - the cached key.
   * @param now - current epoch milliseconds.
   * @returns the replayable verdict, or undefined on miss, expiry, or a disabled cache.
   */
  get(fingerprint: string, now: number): CachedVerdict | undefined {
    if (this.options.ttlMs <= 0) return undefined
    const entry = this.entries.get(fingerprint)
    if (entry === undefined) return undefined
    if (now - entry.at > this.options.ttlMs) {
      this.entries.delete(fingerprint)
      return undefined
    }
    this.hitCount += 1
    return entry.verdict
  }

  /**
   * Store a verdict under a fingerprint, then expire stale entries and evict
   * the oldest beyond the cap.
   * @param fingerprint - the cached key.
   * @param verdict - the verdict to replay on a later hit.
   * @param now - current epoch milliseconds.
   */
  set(fingerprint: string, verdict: CachedVerdict, now: number): void {
    if (this.options.ttlMs <= 0) return
    this.entries.set(fingerprint, { verdict, at: now })
    this.storeCount += 1
    this.evict(now)
  }

  /** Drop expired entries, then the oldest entries beyond {@link VerdictCacheOptions.maxEntries}. */
  private evict(now: number): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.at > this.options.ttlMs) this.entries.delete(key)
    }
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  /** Cumulative cache hits since construction (or the last {@link clear}). */
  get hits(): number {
    return this.hitCount
  }

  /** Cumulative cache stores since construction (or the last {@link clear}). */
  get stores(): number {
    return this.storeCount
  }

  /** Live entry count. */
  get size(): number {
    return this.entries.size
  }

  /** Empty the cache and reset the counters. */
  clear(): void {
    this.entries.clear()
    this.hitCount = 0
    this.storeCount = 0
  }
}
