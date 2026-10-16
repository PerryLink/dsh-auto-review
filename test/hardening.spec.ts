/**
 * Reviewer hardening tests: the two defects that let a reviewer decide on
 * evidence it should never have accepted.
 *
 *  - a secret spelled INSIDE a free-form string argument (a shell command line)
 *    reached the reviewer verbatim, because the key-based redaction inspects
 *    object KEYS only — on both rendering paths, the pending call's own preview
 *    and the compact transcript line;
 *  - a preview cut at `reasonMaxChars` read as complete evidence: a reviewer
 *    shown only the benign head of a long call could allow it with the decisive
 *    arguments cut off.
 * @module dsh-auto-review/test/hardening.spec
 */

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from './call-id.ts'
import {
  buildContextSection,
  buildReviewPrompt,
  renderCallContext,
  resolveConfig,
  sanitizeArguments,
} from '../src/index.ts'
import { makeAgent } from './harness.ts'

/** One raw `tool/call` event carrying `arguments` verbatim, as the runtime reads it. */
function callEvent(argumentsText: string): never {
  return {
    type: 'tool/call',
    seq: 0,
    time: 0,
    data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: argumentsText },
  } as never
}

/** A real session, for the prompt builders that read `request.agent.session`. */
function bareSession(id: string): Session {
  return Session.create(SessionId(id), undefined, {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: 0,
    cwd: path.resolve('work'),
    isSeeded: false,
  })
}

describe('inline-secret redaction', () => {
  it('masks KEY=VALUE, KEY: VALUE and --flag VALUE inside a free-form string', () => {
    const sanitized = sanitizeArguments({
      command: 'deploy --token sk-live-123 --api-key=ak-9 API_SECRET="s3cr3t" PASSWORD=hunter2',
      file_path: '/tmp/plain.txt',
    }) as Record<string, string>
    expect(sanitized.command).toContain('[REDACTED]')
    for (const secret of ['sk-live-123', 'ak-9', 's3cr3t', 'hunter2']) {
      expect(sanitized.command, `leaked ${secret}`).not.toContain(secret)
    }
    // A value with no secret-shaped key next to it is untouched.
    expect(sanitized.file_path).toBe('/tmp/plain.txt')
  })

  it('masks the credential but keeps the Authorization scheme readable', () => {
    const sanitized = sanitizeArguments({
      command: 'curl -H "Authorization: Bearer tok-42" https://example.invalid',
    }) as Record<string, string>
    expect(sanitized.command).toContain('Authorization')
    expect(sanitized.command).toContain('Bearer')
    expect(sanitized.command).not.toContain('tok-42')
  })

  it('leaves a bare secret with no adjacent key visible — the documented best-effort limit', () => {
    // Pinned deliberately: this is a KNOWN limitation, not an accident. If the
    // heuristic is ever strengthened, this case must be updated on purpose.
    const sanitized = sanitizeArguments({ command: 'echo sk-live-123' }) as Record<string, string>
    expect(sanitized.command).toContain('sk-live-123')
  })

  it('redacts the TRANSCRIPT line as well as the pending call', () => {
    // The transcript is a separate rendering path from the pending call's own
    // preview, and it used to pass `arguments` through verbatim.
    const transcript = buildContextSection([callEvent('deploy --token sk-live-123')], { turns: 1, maxChars: 4000 })
    expect(transcript).toContain('[tool call bash]')
    expect(transcript).toContain('[REDACTED]')
    expect(transcript).not.toContain('sk-live-123')
  })
})

describe('truncated-evidence disclosure', () => {
  it('discloses truncation with the exact counts instead of a silent ellipsis', () => {
    const text = renderCallContext([callEvent(JSON.stringify({ command: 'x'.repeat(4000) }))], CallId('call-1'), 2000)
    expect(text).toContain('TRUNCATED')
    expect(text).toMatch(/only the first 2000 of \d+ characters/)
    expect(text).toContain('NOT visible to you')
  })

  it('does not claim truncation for a preview that fits', () => {
    const text = renderCallContext([callEvent('{"command":"echo hi"}')], CallId('call-1'), 2000)
    expect(text).not.toContain('TRUNCATED')
    expect(text).toContain('echo hi')
  })

  it('states the matching deny rule in the prompt', () => {
    const prompt = buildReviewPrompt({ agent: makeAgent(bareSession('hardening-prompt')), toolName: 'bash' }, resolveConfig({}))
    expect(prompt).toContain('- truncated evidence counts as insufficient')
  })
})
