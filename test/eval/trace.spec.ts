/**
 * Trace-collection tests: folding raw session events into owned case traces.
 * @module dsh-auto-review/test/eval/trace
 */

import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { collectTrace, renderToolCall } from '../../src/eval/trace.ts'
import type { CaseTrace } from '../../src/eval/trace.ts'

/** Build a raw event object cast to the session-event union (pure fold tests). */
function event(seq: number, type: string, data: unknown): SessionEvent {
  return { type, seq, time: seq * 1000, data } as unknown as SessionEvent
}

const TOOL_CALL = event(5, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'glob', arguments: '{"pattern":"src/**"}' })
const TOOL_RESULT = event(7, 'tool/result', {
  turn: 1,
  step: 1,
  message: { role: 'user', id: 'm1', source: { kind: 'tool', toolName: 'glob' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'src/index.ts' }] }] },
})

describe('collectTrace', () => {
  it('anchors the fold at firstSeq (startup events excluded)', () => {
    const events = [
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'assistant/message', { turn: 1, step: 0, message: { role: 'assistant', content: [{ type: 'text', text: 'startup noise' }] } }),
      TOOL_CALL,
      TOOL_RESULT,
    ]
    const trace = collectTrace(SessionId('s1'), events, 3)
    expect(trace.firstSeq).toBe(3)
    expect(trace.finalOutput).toBe('')
    expect(trace.toolCalls).toHaveLength(1)
  })

  it('pairs tool calls with results by callId and keeps the last non-empty assistant text', () => {
    const events = [
      TOOL_CALL,
      TOOL_RESULT,
      event(9, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } }),
      event(11, 'assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'text', text: 'final answer' }] } }),
    ]
    const trace = collectTrace(SessionId('s1'), events, 5)
    expect(trace.toolCalls[0]?.name).toBe('glob')
    expect(trace.toolCalls[0]?.argumentsJson).toEqual({ pattern: 'src/**' })
    expect(trace.toolCalls[0]?.result?.text).toBe('src/index.ts')
    expect(trace.toolCalls[0]?.result?.isError).toBe(false)
    expect(trace.finalOutput).toBe('final answer')
    expect(trace.lastSeq).toBe(11)
  })

  it('marks results as errors from the event error identity or the block flag', () => {
    const withEventError = event(7, 'tool/result', {
      turn: 1, step: 1,
      message: { role: 'user', id: 'm1', source: { kind: 'tool', toolName: 'bash' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'boom' }] }] },
      error: { name: 'ExecError', code: 'TIMEOUT' },
    })
    const trace = collectTrace(SessionId('s1'), [TOOL_CALL, withEventError], 5)
    expect(trace.toolCalls[0]?.result?.isError).toBe(true)
    expect(trace.toolCalls[0]?.result?.error).toEqual({ name: 'ExecError', code: 'TIMEOUT' })
  })

  it('sums token usage across assistant messages', () => {
    const events = [
      event(5, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [] }, usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 2 } }),
      event(6, 'assistant/message', { turn: 1, step: 2, message: { role: 'assistant', content: [] }, usage: { inputTokens: 5, outputTokens: 7, reasoningTokens: 4 } }),
    ]
    const trace = collectTrace(SessionId('s1'), events, 5)
    expect(trace.tokenUsage).toEqual({ inputTokens: 15, outputTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 0, reasoningTokens: 4 })
  })

  it('copies the final turn-end reason and the last request header (tool catalog)', () => {
    const events = [
      event(5, 'request/header', { header: { config: { provider: 'p', model: 'm' }, system: 'You are a helpful software engineer assistant.', tools: [{ name: 'read', description: 'read a file' }, { name: 'glob', description: 'list files' }] }, reason: 'initial' }),
      event(6, 'request/context', { provider: 'p', model: 'm', contextWindow: 128000 }),
      event(7, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const trace = collectTrace(SessionId('s1'), events, 5)
    expect(trace.turnEnd).toEqual({ kind: 'completed' })
    expect(trace.requestHeader?.system).toBe('You are a helpful software engineer assistant.')
    expect(trace.requestHeader?.tools.map(tool => tool.name)).toEqual(['read', 'glob'])
    expect(trace.requestHeader?.provider).toBe('p')
    expect(trace.requestHeader?.contextWindow).toBe(128000)
  })

  it('degrades unknown turn-end reasons to a label', () => {
    const trace = collectTrace(SessionId('s1'), [event(5, 'turn/end', { turn: 1, reason: { kind: 'mystery' } })], 5)
    expect(trace.turnEnd).toEqual({ kind: 'unknown' })
  })

  it('ignores unparseable tool arguments', () => {
    const bad = event(5, 'tool/call', { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{not json' })
    const trace = collectTrace(SessionId('s1'), [bad], 5)
    expect(trace.toolCalls[0]?.argumentsJson).toBeUndefined()
  })

  it('collects per-step timing (latency, first/last token, output tokens)', () => {
    const events = [
      event(5, 'step/start', { turn: 1, step: 1 }),
      event(6, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: 'hi' } }),
      event(7, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: ' there' } }),
      event(8, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [] }, usage: { inputTokens: 3, outputTokens: 9 } }),
      event(9, 'step/end', { turn: 1, step: 1 }),
    ]
    const trace = collectTrace(SessionId('s1'), events, 5)
    expect(trace.steps).toHaveLength(1)
    const step = trace.steps?.[0]
    expect(step?.turn).toBe(1)
    expect(step?.startMs).toBe(5000)
    expect(step?.firstTokenMs).toBe(6000)
    expect(step?.lastTokenMs).toBe(7000)
    expect(step?.endMs).toBe(9000)
    expect(step?.outputTokens).toBe(9)
  })

  it('renderToolCall compacts a call to one line', () => {
    const trace: CaseTrace = {
      sessionId: 's1', firstSeq: 0, lastSeq: 9, finalOutput: '',
      toolCalls: [{ callId: 'c1', name: 'glob', arguments: '{"pattern":"src/**"}', argumentsJson: { pattern: 'src/**' }, result: { text: '3 files', isError: false } }],
    }
    const line = renderToolCall(trace.toolCalls[0]!)
    expect(line).toContain('glob')
    expect(line).toContain('3 files')
  })
})
