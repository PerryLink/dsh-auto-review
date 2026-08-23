/**
 * Report-writer tests: Markdown rendering, the CI gate, and file writes.
 * @module dsh-auto-review/test/eval/report
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SuiteReport } from '../../src/eval/runner.ts'
import { exitCodeFor, renderMarkdownReport, renderTerminalSummary, writeReports } from '../../src/eval/report.ts'

const PASS_CASE = {
  id: 'ok', status: 'pass', provider: 'deepseek-official', model: 'deepseek-v4-flash', timeoutMs: 1000, durationMs: 10,
  sessionId: 'session-1', assertions: [{ id: 'output.contains', kind: 'final output', passed: true, expected: 'x', actual: 'x' }],
  trace: { sessionId: 'session-1', firstSeq: 0, lastSeq: 1, toolCalls: [], finalOutput: 'x' },
  input: 'task text',
  tracePath: 'traces/ok.trace.json', sessionLogPath: 'traces/ok.session.jsonl',
}
const FAIL_CASE = {
  id: 'bad', status: 'fail', provider: 'deepseek-official', model: 'deepseek-v4-flash', timeoutMs: 1000, durationMs: 20,
  assertions: [{ id: 'toolCalls[0]', kind: 'tool call', passed: false, expected: 'glob', actual: 'read' }],
  trace: { sessionId: 'session-2', firstSeq: 0, lastSeq: 1, toolCalls: [{ callId: 'c1', name: 'read', arguments: '{"file_path":"a.txt"}', result: { text: 'boom', isError: true } }], finalOutput: '' },
  input: 'other task',
}

function report(statuses: readonly string[]): SuiteReport {
  return {
    suite: 'demo', provider: 'deepseek-official', concurrency: 1,
    startedAt: 1700000000000, finishedAt: 1700000000100, durationMs: 100,
    summary: {
      total: statuses.length,
      pass: statuses.filter(s => s === 'pass').length,
      fail: statuses.filter(s => s === 'fail').length,
      error: statuses.filter(s => s === 'error').length,
      cancelled: statuses.filter(s => s === 'cancelled').length,
    },
    cases: statuses.map((status, index) => ({ ...(status === 'pass' ? PASS_CASE : FAIL_CASE), id: `${status}-${index}`, status }) as SuiteReport['cases'][number]),
  }
}

describe('exitCodeFor', () => {
  it('is 0 only when every case passed (and at least one ran)', () => {
    expect(exitCodeFor(report(['pass', 'pass']))).toBe(0)
    expect(exitCodeFor(report(['pass', 'fail']))).toBe(1)
    expect(exitCodeFor(report(['pass', 'error']))).toBe(1)
    expect(exitCodeFor(report(['pass', 'cancelled']))).toBe(1)
    expect(exitCodeFor(report([]))).toBe(1)
  })
})

describe('renderMarkdownReport', () => {
  it('renders the summary, per-case sections, and replay links', () => {
    const md = renderMarkdownReport(report(['pass', 'fail']))
    expect(md).toContain('# dsh-eval report -- demo')
    expect(md).toContain('1 / 1 / 0 / 0')
    expect(md).toContain('[PASS] pass-0 -- PASS')
    expect(md).toContain('[FAIL] fail-1 -- FAIL')
    expect(md).toContain('[replayable session log](traces/ok.session.jsonl)')
    expect(md).toContain('```text')
    expect(md).toContain('session.jsonl')
  })

  it('renders multi-line assertion detail as a code block (prompt side-by-side diff)', () => {
    const detailed: SuiteReport = {
      ...report(['fail']),
      cases: [{
        ...FAIL_CASE,
        assertions: [{
          id: 'prompt.diff',
          kind: 'prompt regression',
          passed: false,
          expected: 'system prompt matches the baseline',
          actual: '1 changed line(s)',
          detail: 'baseline │ actual\n- a      │ + b',
        }],
      } as SuiteReport['cases'][number]],
    }
    const md = renderMarkdownReport(detailed)
    expect(md).toContain('<details><summary><code>prompt.diff</code> detail</summary>')
    expect(md).toContain('baseline │ actual')
    expect(md).toContain('- a')
  })
})

describe('renderTerminalSummary', () => {
  it('summarizes counts and lists per-case lines', () => {
    const text = renderTerminalSummary(report(['pass', 'fail']))
    expect(text).toContain('1/2 passed')
    expect(text).toContain('pass pass-0')
    expect(text).toContain('fail fail-1')
  })
})

describe('writeReports', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('writes report.json and report.md (and honors file names)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-eval-report-'))
    dirs.push(dir)
    const paths = await writeReports(report(['pass']), dir)
    const json = JSON.parse(await readFile(paths.json, 'utf8')) as { suite: string }
    expect(json.suite).toBe('demo')
    const md = await readFile(paths.markdown as string, 'utf8')
    expect(md).toContain('all passed')
  })

  it('skips the Markdown file when asked', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-eval-report-'))
    dirs.push(dir)
    const paths = await writeReports(report(['pass']), dir, { json: 'x.json', markdown: null })
    expect(paths.markdown).toBeUndefined()
    expect(paths.json.endsWith('x.json')).toBe(true)
  })
})
