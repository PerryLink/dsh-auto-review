/**
 * Prompt-regression diff tests: line alignment and the side-by-side renderer.
 * @module dsh-auto-review/test/eval/diff
 */

import { describe, expect, it } from 'vitest'
import { diffLines, hasChanges, renderSideBySide } from '../../src/eval/diff.ts'

describe('diffLines', () => {
  it('reports no changes for identical text', () => {
    const rows = diffLines('a\nb\nc', 'a\nb\nc')
    expect(hasChanges(rows)).toBe(false)
    expect(rows.map(row => row.kind)).toEqual(['unchanged', 'unchanged', 'unchanged'])
  })

  it('detects an added and a removed line', () => {
    const rows = diffLines('a\nb', 'a\nc')
    expect(rows.map(row => row.kind)).toEqual(['unchanged', 'removed', 'added'])
    expect(rows.find(row => row.kind === 'removed')?.baseline).toBe('b')
    expect(rows.find(row => row.kind === 'added')?.actual).toBe('c')
  })

  it('aligns a changed middle line while keeping the prefix and suffix', () => {
    const rows = diffLines('You are a helpful assistant.\nBe concise.\n', 'You are a helpful software engineer.\nBe concise.\n')
    expect(rows[0]?.kind).toBe('removed')
    expect(rows[1]?.kind).toBe('added')
    expect(rows[2]?.kind).toBe('unchanged')
  })

  it('tolerates CRLF and a trailing newline', () => {
    expect(hasChanges(diffLines('a\r\nb\r\n', 'a\nb\n'))).toBe(false)
  })

  it('falls back to a naive diff for oversized inputs', () => {
    const big = Array.from({ length: 1100 }, (_, index) => `line-${index}`).join('\n')
    const rows = diffLines(big, big)
    // 1100 × 1100 exceeds the LCS cell cap; the naive path still reports no
    // changes when the inputs are identical.
    expect(hasChanges(rows)).toBe(false)
  })
})

describe('renderSideBySide', () => {
  it('renders a two-column diff with change markers', () => {
    const rows = diffLines('a\n', 'b\n')
    const text = renderSideBySide(rows, 'baseline', 'actual', 10)
    expect(text).toContain('baseline')
    expect(text).toContain('actual')
    expect(text).toContain('- a')
    expect(text).toContain('+ b')
    expect(text).toContain('│')
  })
})
