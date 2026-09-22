/**
 * Tool-result shape compatibility: host `dsh-v0.1.7-alpha.1` writes a
 * first-class `role: 'tool'` message, the `0.1.6-alpha.2` line wrote a
 * `tool-result` wrapper block, and the readers accept both (read-only: this
 * package never constructs the retired shape).
 * @module dsh-auto-review/test/session-message
 */

import { describe, expect, it } from 'vitest'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { CallId } from './call-id.ts'
import { readToolResult, toolResultIsError, toolResultText } from '../src/session-message.ts'

/** The current V4 shape the installed host writes, through its own factory. */
function v4Message(text: string, isError = false) {
  return createToolResultMessage({
    callId: CallId('call-1'),
    content: [{ type: 'text', text }],
    isError,
  })
}

/** The released-V3 wrapper row shape, as persisted by the 0.1.6-alpha.2 line. */
function v3Message(text: string, isError?: boolean) {
  return {
    id: 'msg-1',
    role: 'user',
    source: { kind: 'tool', callId: 'call-1' },
    content: [{
      type: 'tool-result',
      toolCallId: 'call-1',
      content: [{ type: 'text', text }],
      ...(isError === undefined ? {} : { isError }),
    }],
  }
}

describe('readToolResult', () => {
  it('reads the V4 first-class tool message', () => {
    const view = readToolResult(v4Message('hello'))
    expect(view).toEqual({ callId: 'call-1', content: [{ type: 'text', text: 'hello' }], isError: false })
  })

  it('reads the released-V3 tool-result wrapper', () => {
    const view = readToolResult(v3Message('hello', true))
    expect(view).toEqual({ callId: 'call-1', content: [{ type: 'text', text: 'hello' }], isError: true })
  })

  it('falls back to the tool source callId when the shape omits its own', () => {
    const view = readToolResult({
      role: 'tool',
      source: { kind: 'tool', callId: 'from-source' },
      content: [{ type: 'text', text: 'body' }],
    })
    expect(view?.callId).toBe('from-source')
  })

  it('refuses a row that carries no tool result at all', () => {
    expect(readToolResult({ role: 'user', content: [{ type: 'text', text: 'just prose' }] })).toBeUndefined()
    expect(readToolResult({ role: 'tool', content: [{ type: 'text', text: 'no call id' }] })).toBeUndefined()
    expect(readToolResult(undefined)).toBeUndefined()
    expect(readToolResult(null)).toBeUndefined()
  })

  it('joins only the text blocks', () => {
    const view = readToolResult({
      role: 'tool',
      toolCallId: 'call-2',
      content: [{ type: 'image', source: {} }, { type: 'text', text: 'a' }, { type: 'text', text: 'b' }],
    })
    expect(view).toBeDefined()
    expect(toolResultText(view!)).toBe('a\nb')
  })

  it('treats the event error identity and the message flag as the same failure signal', () => {
    expect(toolResultIsError(undefined, readToolResult(v4Message('ok', false))!)).toBe(false)
    expect(toolResultIsError(undefined, readToolResult(v4Message('bad', true))!)).toBe(true)
    expect(toolResultIsError({ name: 'Error', code: 'X' }, readToolResult(v4Message('bad', false))!)).toBe(true)
    // A V3 wrapper without its own isError flag still fails when the event carries error metadata.
    expect(toolResultIsError({ name: 'Error', code: 'X' }, readToolResult(v3Message('bad'))!)).toBe(true)
  })
})
