/**
 * Session-artifact format contract: the eval runner's `*.session.jsonl`
 * header must be valid in the installed host's format vocabulary (L6), an
 * artifact written by an older line must stay readable on the installed line,
 * and a mislabeled, malformed, or unmarked-unknown-event artifact must be
 * refused instead of silently misread (U6).
 * @module dsh-auto-review/test/eval/session-artifact
 */

import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { describe, expect, it } from 'vitest'
import { renderSessionArtifact, sessionHeaderLine } from '../../src/eval/runner.ts'

const CREATED_AT = 1_700_000_000_000

/** The installed line's logical header, unseeded and rooted at the repo. */
function makeHeader(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId('artifact-session'),
    createdAt: CREATED_AT,
    cwd: process.cwd(),
    isSeeded: false,
    delegationDepth: 0,
    ...overrides,
  } as SessionHeader
}

/** The smallest valid released event pair (one completed turn). */
function makeEvents(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
    { type: 'turn/end', seq: 1, time: 2000, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as unknown as SessionEvent[]
}

/** Split one artifact into its parsed header line and parsed body rows. */
function parseArtifact(text: string): { headerLine: Record<string, unknown>; rows: unknown[] } {
  const lines = text.trimEnd().split('\n')
  return {
    headerLine: JSON.parse(lines[0] as string) as Record<string, unknown>,
    rows: lines.slice(1).map(line => JSON.parse(line) as unknown),
  }
}

describe('sessionHeaderLine', () => {
  it('emits the installed line\'s seed field and never the retired V0 seedLength', () => {
    // The inherited count is supplied on purpose: a V2/V3 header must ignore
    // it (the seed cut travels on the log's `session/end-seed` marker), while
    // the V0 line records it as `seedLength`.
    const line = sessionHeaderLine(makeHeader(), 7)
    if (SESSION_FORMAT_VERSION >= 2) {
      expect(line['isSeeded']).toBe(false)
      expect(line).not.toHaveProperty('seedLength')
    } else {
      expect(line['seedLength']).toBe(7)
      expect(line).not.toHaveProperty('isSeeded')
    }
    const read = sessionFormatCatalog.readHeader(line)
    expect(read.status).toBe(SESSION_FORMAT_VERSION === sessionFormatCatalog.currentVersion ? 'current' : 'migration-required')
  })

  it('carries isSeeded through for a seeded header', () => {
    const line = sessionHeaderLine(makeHeader({ isSeeded: true }), 7)
    if (SESSION_FORMAT_VERSION >= 2) expect(line['isSeeded']).toBe(true)
    expect(sessionFormatCatalog.readHeader(line).status).not.toBe('malformed')
  })
})

describe('rendered session artifact replay (L6)', () => {
  it('writes a header the installed format catalog classifies as replayable', () => {
    const { headerLine } = parseArtifact(renderSessionArtifact(makeHeader(), makeEvents()))
    expect(headerLine['version']).toBe(SESSION_FORMAT_VERSION)
    const read = sessionFormatCatalog.readHeader(headerLine)
    expect(read.status).toBe(SESSION_FORMAT_VERSION === sessionFormatCatalog.currentVersion ? 'current' : 'migration-required')
    if (read.status === 'malformed' || read.status === 'unsupported') throw new Error(`artifact header refused: ${read.reason}`)
    expect(read.header.isSeeded).toBe(false)
    expect(read.header.id).toBe('artifact-session')
  })

  it('replays the full artifact into a current logical session', () => {
    const { headerLine, rows } = parseArtifact(renderSessionArtifact(makeHeader(), makeEvents()))
    const restore = sessionFormatCatalog.createRestore(headerLine, { recovery: 'strict', validation: 'current' })
    for (const row of rows) restore.decodeRow(row)
    const artifact = restore.finish()
    expect(artifact.header.id).toBe('artifact-session')
    expect(artifact.header.isSeeded).toBe(false)
    expect(artifact.events.map(event => event.type)).toEqual(['turn/start', 'turn/end'])
    expect(artifact.inheritedEventCount).toBe(0)
  })

  it('keeps a V0-line header readable on the installed line, preserving its seed semantics', () => {
    const legacy = {
      type: 'session',
      version: 0,
      id: 'legacy-session',
      createdAt: CREATED_AT,
      cwd: process.cwd(),
      delegationDepth: 0,
    }
    const unseeded = sessionFormatCatalog.readHeader(legacy)
    expect(unseeded.status).toBe(sessionFormatCatalog.currentVersion === 0 ? 'current' : 'migration-required')
    if (unseeded.status === 'malformed' || unseeded.status === 'unsupported') throw new Error(`legacy header refused: ${unseeded.reason}`)
    expect(unseeded.storedVersion).toBe(0)
    expect(unseeded.header.isSeeded).toBe(false)

    // The V0 line marks a seeded session by the presence of `seedLength`.
    const seeded = sessionFormatCatalog.readHeader({ ...legacy, seedLength: 0 })
    expect(seeded.status).toBe(sessionFormatCatalog.currentVersion === 0 ? 'current' : 'migration-required')
    if (seeded.status === 'malformed' || seeded.status === 'unsupported') throw new Error(`legacy seeded header refused: ${seeded.reason}`)
    expect(seeded.header.isSeeded).toBe(true)
  })
})

describe('malformed and unsupported headers (U6)', () => {
  /** One valid current physical header, before the variant under test. */
  const valid: Record<string, unknown> = {
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    id: 'fixture',
    createdAt: CREATED_AT,
    cwd: process.cwd(),
    isSeeded: false,
    delegationDepth: 0,
  }

  it('refuses a V2/V3 header missing isSeeded', () => {
    const missing: Record<string, unknown> = { ...valid }
    delete missing['isSeeded']
    expect(sessionFormatCatalog.readHeader(missing).status).toBe('malformed')
  })

  it('refuses a V2/V3 header carrying the retired V0 seedLength', () => {
    expect(sessionFormatCatalog.readHeader({ ...valid, seedLength: 3 }).status).toBe('malformed')
  })

  it('refuses a non-boolean isSeeded', () => {
    expect(sessionFormatCatalog.readHeader({ ...valid, isSeeded: 0 }).status).toBe('malformed')
  })

  it('refuses a header written by a newer format instead of downgrading it', () => {
    const read = sessionFormatCatalog.readHeader({ ...valid, version: sessionFormatCatalog.currentVersion + 1 })
    expect(read.status).toBe('unsupported')
    if (read.status === 'unsupported') expect(read.reason).toContain('newer format')
  })

  it('refuses a V3 body smuggled behind a V2 header', () => {
    // A `system/message` node is V3-only; a reader that trusted the mislabeled
    // version would migrate it as V2 and silently drop the surface meaning.
    const v3Events = [
      ...makeEvents(),
      { type: 'system/message', seq: 2, time: 3000, data: { turn: 1, step: 1, message: { role: 'system', content: [{ type: 'text', text: 'smuggled' }] } }, surfaceOp: 'append' },
    ]
    const { headerLine, rows } = parseArtifact(renderSessionArtifact(makeHeader(), v3Events as unknown as SessionEvent[]))
    const mislabeled = { ...headerLine, version: 2 }
    expect(sessionFormatCatalog.readHeader(mislabeled).status).toBe('migration-required')
    const restore = sessionFormatCatalog.createRestore(mislabeled, { recovery: 'strict', validation: 'current' })
    expect(() => {
      for (const row of rows) restore.decodeRow(row)
      restore.finish()
    }).toThrow()
  })

  it('fails closed on an unmarked unknown autoReview event in the artifact body', () => {
    const events = [
      ...makeEvents(),
      { type: 'autoReview/state', seq: 2, time: 3000, data: { state: 'on' } },
    ] as unknown as SessionEvent[]
    const { headerLine, rows } = parseArtifact(renderSessionArtifact(makeHeader(), events))
    const restore = sessionFormatCatalog.createRestore(headerLine, { recovery: 'strict', validation: 'current' })
    expect(() => {
      for (const row of rows) restore.decodeRow(row)
      restore.finish()
    }).toThrow(/unknown event type/u)
  })
})
