/**
 * Assertion-engine tests: the pure expectation checks over owned traces.
 * @module dsh-auto-review/test/eval/assert
 */

import { describe, expect, it } from 'vitest'
import { deepContains, runAssertions, toolNameMatches, validateExpectations } from '../../src/eval/assert.ts'
import { parseSuite } from '../../src/eval/dsl.ts'
import type { EvalCase } from '../../src/eval/dsl.ts'
import type { CaseTrace } from '../../src/eval/trace.ts'

/** Build a minimal owned trace with the given tool calls and output. */
function trace(toolCalls: CaseTrace['toolCalls'] = [], finalOutput = 'done', turnEnd: CaseTrace['turnEnd'] = { kind: 'completed' }, tokenUsage?: CaseTrace['tokenUsage']): CaseTrace {
  return { sessionId: 's1', firstSeq: 0, lastSeq: 9, toolCalls, finalOutput, ...(turnEnd !== undefined ? { turnEnd } : {}), ...(tokenUsage !== undefined ? { tokenUsage } : {}) }
}

const GLOB_CALL = { callId: 'c1', name: 'glob', arguments: '{"pattern":"src/**"}', argumentsJson: { pattern: 'src/**' }, result: { text: 'src/index.ts\nsrc/config.ts', isError: false } }
const READ_CALL = { callId: 'c2', name: 'read', arguments: '{"file_path":"src/config.ts"}', argumentsJson: { file_path: 'src/config.ts' }, result: { text: 'reviewerTimeoutMs 60000', isError: false } }

function caseFrom(yaml: string): EvalCase {
  const suite = parseSuite(`name: m\ncases:\n${yaml.split('\n').map(line => `  ${line}`).join('\n')}\n`)
  return suite.cases[0] as EvalCase
}

describe('deepContains', () => {
  it('substring-matches string leaves', () => {
    expect(deepContains({ file_path: 'src/config.ts' }, { file_path: 'config.ts' })).toBe(true)
    expect(deepContains({ file_path: 'src/config.ts' }, { file_path: 'readme' })).toBe(false)
    expect(deepContains({ n: 5 }, { n: 5 })).toBe(true)
    expect(deepContains({ n: 5 }, { n: 4 })).toBe(false)
  })

  it('recurses into objects and arrays (ordered, prefix allowed)', () => {
    expect(deepContains({ a: { b: [1, 2, 3] } }, { a: { b: [1, 2] } })).toBe(true)
    expect(deepContains({ a: { b: [1, 2, 3] } }, { a: { b: [3] } })).toBe(false)
    expect(deepContains({ a: 1 }, { b: 1 })).toBe(false)
  })
})

describe('toolNameMatches', () => {
  it('supports exact names and suffix wildcards', () => {
    expect(toolNameMatches('glob', 'glob')).toBe(true)
    expect(toolNameMatches('glob', 'read')).toBe(false)
    expect(toolNameMatches('subagent_*', 'subagent_fork')).toBe(true)
    expect(toolNameMatches('*', 'anything')).toBe(true)
  })
})

describe('runAssertions', () => {
  it('passes a fully satisfied case', () => {
    const caze = caseFrom([
      '- id: a',
      '  input: "1"',
      '  expect:',
      '    toolCalls:',
      '      - tool: glob',
      '        arguments:',
      '          contains: {pattern: "src"}',
      '    results:',
      '      - tool: read',
      '        contains: "60000"',
      '    output:',
      '      contains: "done"',
    ].join('\n'))
    const results = runAssertions(caze, trace([GLOB_CALL, READ_CALL]))
    expect(results.every(item => item.passed)).toBe(true)
    expect(results.map(item => item.id)).toEqual(['toolCalls[0]', 'results[0]', 'output.contains', 'turnEnds'])
  })

  it('fails a missing tool call with the actual sequence in the message', () => {
    const caze = caseFrom(['- id: a', '  input: "1"', '  expect:', '    toolCalls:', '      - tool: write'].join('\n'))
    const results = runAssertions(caze, trace([GLOB_CALL]))
    const call = results.find(item => item.id === 'toolCalls[0]')
    expect(call?.passed).toBe(false)
    expect(call?.actual).toContain('glob')
  })

  it('matches tool calls as a subsequence with skips (wildcard allowed)', () => {
    const caze = caseFrom(['- id: a', '  input: "1"', '  expect:', '    toolCalls:', '      - tool: "read*"', '      - tool: glob'].join('\n'))
    const results = runAssertions(caze, trace([GLOB_CALL, READ_CALL, GLOB_CALL]))
    expect(results.find(item => item.id === 'toolCalls[0]')?.passed).toBe(true)
    expect(results.find(item => item.id === 'toolCalls[1]')?.passed).toBe(true)
  })

  it('enforces the exact tool-name sequence mode', () => {
    const caze = caseFrom(['- id: a', '  input: "1"', '  expect:', '    toolCallsExact: [glob, read]'].join('\n'))
    expect(runAssertions(caze, trace([GLOB_CALL, READ_CALL])).find(item => item.id === 'toolCallsExact')?.passed).toBe(true)
    expect(runAssertions(caze, trace([READ_CALL, GLOB_CALL])).find(item => item.id === 'toolCallsExact')?.passed).toBe(false)
  })

  it('enforces the noToolCalls gate both ways', () => {
    const none = caseFrom(['- id: a', '  input: "1"', '  expect:', '    noToolCalls: true'].join('\n'))
    const some = caseFrom(['- id: a', '  input: "1"', '  expect:', '    noToolCalls: false'].join('\n'))
    expect(runAssertions(none, trace()).find(item => item.id === 'noToolCalls')?.passed).toBe(true)
    expect(runAssertions(none, trace([GLOB_CALL])).find(item => item.id === 'noToolCalls')?.passed).toBe(false)
    expect(runAssertions(some, trace([GLOB_CALL])).find(item => item.id === 'noToolCalls')?.passed).toBe(true)
  })

  it('asserts result isError, contains, and regex on the n-th occurrence', () => {
    const caze = caseFrom([
      '- id: a', '  input: "1"', '  expect:', '    results:',
      '      - tool: read', '        index: 1', '        contains: "never"',
    ].join('\n'))
    const otherRead = { ...READ_CALL, callId: 'c3', result: { text: 'something else', isError: false } }
    expect(runAssertions(caze, trace([READ_CALL, otherRead])).find(item => item.id === 'results[0]')?.passed).toBe(false)
  })

  it('asserts every output matcher', () => {
    const caze = caseFrom(['- id: a', '  input: "1"', '  expect:', '    output:', '      contains: "ok"', '      notContains: "nope"', '      regex: \'\\d+\'', '      notRegex: "zzz"'].join('\n'))
    const results = runAssertions(caze, trace([], 'answer ok 42'))
    expect(results.filter(item => item.id.startsWith('output')).every(item => item.passed)).toBe(true)
    const failing = runAssertions(caze, trace([], 'nope'))
    expect(failing.find(item => item.id === 'output.contains')?.passed).toBe(false)
    expect(failing.find(item => item.id === 'output.notContains')?.passed).toBe(false)
  })

  it('gates the turn outcome and the token budget', () => {
    const caze = caseFrom(['- id: a', '  input: "1"', '  expect:', '    maxTokens: 10'].join('\n'))
    const aborted = runAssertions(caze, trace([], 'x', { kind: 'aborted' }, { inputTokens: 1, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }))
    expect(aborted.find(item => item.id === 'turnEnds')?.passed).toBe(false)
    expect(aborted.find(item => item.id === 'maxTokens')?.passed).toBe(true)
    const over = runAssertions(caze, trace([], 'x', { kind: 'completed' }, { inputTokens: 1, outputTokens: 11, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }))
    expect(over.find(item => item.id === 'maxTokens')?.passed).toBe(false)
  })
})

describe('validateExpectations', () => {
  it('throws on invalid regexes before any agent runs', () => {
    const caze = caseFrom(['- id: a', '  input: "1"', '  expect:', '    output:', '      regex: "(["'].join('\n'))
    expect(() => validateExpectations(caze)).toThrow(/invalid regular expression/u)
    const good = caseFrom(['- id: a', '  input: "1"', '  expect:', '    output:', '      regex: \'\\d+\''].join('\n'))
    expect(() => validateExpectations(good)).not.toThrow()
  })
})
