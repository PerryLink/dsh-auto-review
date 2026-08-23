/**
 * Prompt-regression diff: a pure, dependency-free line differ plus a
 * side-by-side renderer. The `expect.prompt` assertion compares the agent's
 * rendered system prompt against a committed baseline; any drift — the "one
 * word change breaks ten cases" failure mode — is reported here as a
 * two-column diff instead of a single opaque mismatch.
 * @module dsh-auto-review/eval/diff
 */

/** One aligned diff row: unchanged, a baseline-only removal, or an actual-only addition. */
export interface DiffRow {
  /** How this row changed. */
  readonly kind: 'unchanged' | 'removed' | 'added'
  /** The baseline-side text (absent for `added`). */
  readonly baseline?: string
  /** The actual-side text (absent for `removed`). */
  readonly actual?: string
}

/** Whether a diff carries any change. */
export function hasChanges(rows: readonly DiffRow[]): boolean {
  return rows.some(row => row.kind !== 'unchanged')
}

/** Split text into lines, tolerating CRLF and a trailing newline. */
function splitLines(text: string): string[] {
  return text.replaceAll('\r\n', '\n').split('\n')
}

/** Cell-count guard above which the LCS table is skipped for a naive diff. */
const LCS_CELL_CAP = 1_000_000

/**
 * Diff two texts line by line. Rows are aligned by longest common
 * subsequence; a replaced region is emitted as its baseline removals
 * followed by its actual additions. Oversized inputs fall back to a naive
 * full-replace diff rather than allocating an unbounded table.
 * @param baseline - the committed baseline text.
 * @param actual - the captured system prompt text.
 * @returns the aligned diff rows.
 */
export function diffLines(baseline: string, actual: string): DiffRow[] {
  const left = splitLines(baseline)
  const right = splitLines(actual)
  if (left.length * right.length > LCS_CELL_CAP) return naiveDiff(left, right)
  return lcsDiff(left, right)
}

/**
 * Prefix/suffix-trimmed diff for oversized inputs: identical leading and
 * trailing lines stay aligned, and the middle is a full replace. The LCS
 * table would be unbounded, so this degrades gracefully instead of failing.
 */
function naiveDiff(left: readonly string[], right: readonly string[]): DiffRow[] {
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1
  let endL = left.length
  let endR = right.length
  while (endL > start && endR > start && left[endL - 1] === right[endR - 1]) {
    endL -= 1
    endR -= 1
  }
  const rows: DiffRow[] = []
  for (let i = 0; i < start; i += 1) {
    rows.push({ kind: 'unchanged', baseline: left[i] as string, actual: right[i] as string })
  }
  for (let i = start; i < endL; i += 1) rows.push({ kind: 'removed', baseline: left[i] as string })
  for (let j = start; j < endR; j += 1) rows.push({ kind: 'added', actual: right[j] as string })
  for (let i = endL; i < left.length; i += 1) {
    rows.push({ kind: 'unchanged', baseline: left[i] as string, actual: right[endR + (i - endL)] as string })
  }
  return rows
}

/** Longest-common-subsequence diff over two line arrays. */
function lcsDiff(left: readonly string[], right: readonly string[]): DiffRow[] {
  const n = left.length
  const m = right.length
  const width = m + 1
  // dp[i][j] = LCS length of left[i..] and right[j..]; a flat table keeps
  // index access total (Int32Array indexing never yields undefined). Loop
  // bounds guarantee the array lookups below are in range.
  const dp = new Int32Array((n + 1) * width)
  const at = (i: number, j: number): number => dp[i * width + j] as number
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * width + j] = left[i] === right[j]
        ? at(i + 1, j + 1) + 1
        : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      rows.push({ kind: 'unchanged', baseline: left[i] as string, actual: right[j] as string })
      i += 1
      j += 1
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      rows.push({ kind: 'removed', baseline: left[i] as string })
      i += 1
    } else {
      rows.push({ kind: 'added', actual: right[j] as string })
      j += 1
    }
  }
  while (i < n) {
    rows.push({ kind: 'removed', baseline: left[i] as string })
    i += 1
  }
  while (j < m) {
    rows.push({ kind: 'added', actual: right[j] as string })
    j += 1
  }
  return rows
}

/**
 * Render a diff as an aligned two-column text block (baseline left, actual
 * right, `-`/`+` change markers). The prompt assertion attaches this to the
 * report so a drifted prompt reads as a reviewable diff.
 * @param rows - the diff rows.
 * @param leftLabel - the left column header.
 * @param rightLabel - the right column header.
 * @param width - per-column width in characters.
 * @returns the side-by-side text.
 */
export function renderSideBySide(
  rows: readonly DiffRow[],
  leftLabel = 'baseline',
  rightLabel = 'actual',
  width = 50,
): string {
  const clip = (text: string): string => (text.length <= width ? text : `${text.slice(0, width - 1)}…`)
  const pad = (text: string): string => clip(text).padEnd(width, ' ')
  const mark = (kind: DiffRow['kind']): string => {
    switch (kind) {
      case 'unchanged': return ' '
      case 'removed': return '-'
      case 'added': return '+'
    }
  }
  const lines = [`${pad(leftLabel)} │ ${pad(rightLabel)}`]
  for (const row of rows) {
    const left = row.kind === 'added' ? '' : row.baseline ?? ''
    const right = row.kind === 'removed' ? '' : row.actual ?? ''
    lines.push(`${pad(`${mark(row.kind)} ${left}`)} │ ${pad(`${mark(row.kind)} ${right}`)}`)
  }
  return lines.join('\n')
}
