/**
 * The structured assertion engine of dsh-eval: pure functions that check a
 * collected {@link CaseTrace} against a case's `expect` block. Every
 * assertion reports its own pass/fail with the expected and actual values,
 * so reports can explain WHY a case failed without rerunning it.
 * @module dsh-auto-review/eval/assert
 */

import { DslError } from './dsl.ts'
import type { EvalCase, ToolCallExpectation } from './dsl.ts'
import { diffLines, hasChanges, renderSideBySide } from './diff.ts'
import { computeStressMetrics } from './stress.ts'
import type { CaseTrace, ToolCallRecord } from './trace.ts'

/** One evaluated assertion. */
export interface AssertionResult {
  /** Stable id inside the case (`toolCalls[0]`, `results[1]`, `output.contains`, …). */
  readonly id: string
  /** Human-readable assertion kind. */
  readonly kind: string
  readonly passed: boolean
  /** Human-readable expectation, rendered from the DSL. */
  readonly expected: string
  /** Human-readable actual state. */
  readonly actual: string
  /** Optional multi-line detail (a side-by-side prompt diff, a bias radar). */
  readonly detail?: string
}

/** Whether a tool-name pattern matches an actual tool name (exact or `*` suffix wildcard). */
export function toolNameMatches(pattern: string, actual: string): boolean {
  if (pattern.endsWith('*')) return actual.startsWith(pattern.slice(0, -1))
  return pattern === actual
}

/**
 * Deep-partial containment: every leaf of `expected` must exist in `actual`.
 * Object keys recurse, arrays match index-wise, and a string leaf matches
 * when the actual value is a string CONTAINING it (substring semantics — the
 * natural reading of `contains: {file_path: "config.ts"}` over the actual
 * `"src/config.ts"`); use `equals` for exact string matching.
 */
export function deepContains(actual: unknown, expected: unknown): boolean {
  if (typeof expected === 'string') return typeof actual === 'string' && actual.includes(expected)
  if (typeof expected !== 'object' || expected === null) return actual === expected
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((item, index) => deepContains((actual as unknown[])[index], item))
  }
  if (typeof actual !== 'object' || actual === null) return false
  const actualRecord = actual as Record<string, unknown>
  return Object.entries(expected).every(([key, value]) =>
    Object.hasOwn(actualRecord, key) && deepContains(actualRecord[key], value))
}

/** Regex argument matching: every key's actual string value must match the expected regex. */
export function argumentsMatchRegexes(actual: unknown, expected: Record<string, string>): boolean {
  if (typeof actual !== 'object' || actual === null) return false
  const actualRecord = actual as Record<string, unknown>
  return Object.entries(expected).every(([key, source]) => {
    const value = actualRecord[key]
    return typeof value === 'string' && new RegExp(source, 'u').test(value)
  })
}

/** Evaluate one argument expectation against parsed arguments. */
function argumentsSatisfy(
  parsed: unknown,
  expectation: ToolCallExpectation['arguments'],
): { passed: boolean; detail: string } {
  if (expectation === undefined) return { passed: true, detail: 'no argument expectation' }
  if (parsed === undefined) return { passed: false, detail: 'arguments are not valid JSON (cannot match)' }
  if (expectation.equals !== undefined) {
    const passed = JSON.stringify(parsed) === JSON.stringify(expectation.equals)
    return { passed, detail: passed ? 'equals' : `does not equal ${JSON.stringify(expectation.equals)}` }
  }
  if (expectation.contains !== undefined) {
    const passed = deepContains(parsed, expectation.contains)
    return { passed, detail: passed ? 'contains' : `does not contain ${JSON.stringify(expectation.contains)}` }
  }
  if (expectation.matches !== undefined) {
    const passed = argumentsMatchRegexes(parsed, expectation.matches)
    return { passed, detail: passed ? 'matches' : `does not match ${JSON.stringify(expectation.matches)}` }
  }
  return { passed: true, detail: 'empty argument expectation' }
}

/** Render one argument expectation compactly. */
export function renderArgumentExpectation(expectation: ToolCallExpectation['arguments']): string {
  if (expectation === undefined) return '(none)'
  if (expectation.equals !== undefined) return `equals ${JSON.stringify(expectation.equals)}`
  if (expectation.contains !== undefined) return `contains ${JSON.stringify(expectation.contains)}`
  if (expectation.matches !== undefined) return `matches ${JSON.stringify(expectation.matches)}`
  return '(none)'
}

/**
 * Compile-time validation of a case's expectation block: every regex must be
 * valid JavaScript (the engine fails the suite loudly instead of failing
 * each assertion at run time). Throws a TypeError on the first bad regex.
 * @param caze - the validated case.
 */
export function validateExpectations(caze: EvalCase): void {
  const check = (source: string): void => {
    try {
      new RegExp(source, 'u')
    } catch (error: unknown) {
      throw new DslError(`case "${caze.id}": invalid regular expression ${JSON.stringify(source)}: ${String(error)}`)
    }
  }
  for (const result of caze.expect.results) if (result.regex !== undefined) check(result.regex)
  for (const key of ['regex', 'notRegex'] as const) {
    const output = caze.expect.output
    if (output !== undefined && output[key] !== undefined) check(output[key] as string)
  }
  for (const source of caze.expect.prompt?.allowedChanges ?? []) check(source)
  for (const source of caze.expect.bias?.forbid ?? []) check(source)
  for (const sources of Object.values(caze.expect.bias?.categories ?? {})) {
    for (const source of sources) check(source)
  }
}

/** Count non-overlapping regex matches across sources (compiled with the unicode + global flags). */
function countRegexMatches(text: string, sources: readonly string[]): number {
  let total = 0
  for (const source of sources) {
    const regex = new RegExp(source, 'gu')
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      total += 1
      if (match[0] === '') regex.lastIndex += 1
    }
  }
  return total
}

/** Count matches per bias category (one radar axis each). */
function biasCategoryCounts(text: string, categories: Readonly<Record<string, readonly string[]>>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const [category, sources] of Object.entries(categories)) {
    counts.set(category, countRegexMatches(text, sources))
  }
  return counts
}

/** Render a compact per-category count list (the bias radar). */
function renderRadar(counts: ReadonlyMap<string, number>): string {
  const entries = [...counts.entries()].map(([category, count]) => `${category}: ${count}`)
  return entries.length === 0 ? '(no categories)' : entries.join(', ')
}

/**
 * Run every structured assertion of one case against its trace. Review
 * assertions live in a separate layer (see `review.ts`).
 * @param caze - the case (expectations).
 * @param trace - the collected trace.
 * @returns one result per assertion, in definition order.
 */
export function runAssertions(caze: EvalCase, trace: CaseTrace, promptBaselines?: ReadonlyMap<string, string>): AssertionResult[] {
  const results: AssertionResult[] = []
  const push = (result: AssertionResult): void => {
    results.push(result)
  }
  // Ordered tool-call sequence (subsequence matching with skips).
  const consumed = new Set<number>()
  caze.expect.toolCalls.forEach((expectation, index) => {
    const id = `toolCalls[${index}]`
    let matched: ToolCallRecord | undefined
    for (let cursor = 0; cursor < trace.toolCalls.length; cursor += 1) {
      if (consumed.has(cursor)) continue
      const call = trace.toolCalls[cursor] as ToolCallRecord
      if (!toolNameMatches(expectation.tool, call.name)) continue
      const argumentCheck = argumentsSatisfy(call.argumentsJson, expectation.arguments)
      if (!argumentCheck.passed) continue
      consumed.add(cursor)
      matched = call
      break
    }
    const expected = `${expectation.tool}${expectation.arguments !== undefined ? ` (${renderArgumentExpectation(expectation.arguments)})` : ''}`
    if (matched === undefined) {
      push({
        id,
        kind: 'tool call',
        passed: false,
        expected,
        actual: `not found in the ${trace.toolCalls.length}-call trace: ${trace.toolCalls.map(call => call.name).join(', ') || '(no tool calls)'}`,
      })
    } else {
      push({ id, kind: 'tool call', passed: true, expected, actual: `call #${matched.callId} ${matched.name}` })
    }
  })
  // Exact tool-name sequence.
  if (caze.expect.toolCallsExact !== undefined) {
    const expected = caze.expect.toolCallsExact.join(', ')
    const actual = trace.toolCalls.map(call => call.name).join(', ')
    push({
      id: 'toolCallsExact',
      kind: 'tool-call sequence (exact)',
      passed: actual === expected,
      expected,
      actual: actual === '' ? '(no tool calls)' : actual,
    })
  }
  // No-tool-calls gate.
  if (caze.expect.noToolCalls !== undefined) {
    const passed = (trace.toolCalls.length === 0) === caze.expect.noToolCalls
    push({
      id: 'noToolCalls',
      kind: 'tool-call count',
      passed,
      expected: caze.expect.noToolCalls ? 'no tool calls' : 'at least one tool call',
      actual: `${trace.toolCalls.length} tool call(s)`,
    })
  }
  // Per-tool result assertions (n-th occurrence).
  caze.expect.results.forEach((expectation, index) => {
    const id = `results[${index}]`
    const occurrence = trace.toolCalls.filter(call => toolNameMatches(expectation.tool, call.name))[expectation.index]
    if (occurrence === undefined) {
      push({
        id,
        kind: 'tool result',
        passed: false,
        expected: `${expectation.tool}#${expectation.index} result`,
        actual: `no such occurrence (${trace.toolCalls.filter(call => toolNameMatches(expectation.tool, call.name)).length} call(s) of ${expectation.tool})`,
      })
      return
    }
    const result = occurrence.result
    if (result === undefined) {
      push({ id, kind: 'tool result', passed: false, expected: `${expectation.tool}#${expectation.index} result recorded`, actual: 'no result recorded for this call' })
      return
    }
    const failures: string[] = []
    if (expectation.isError !== undefined && result.isError !== expectation.isError) {
      failures.push(`isError: expected ${String(expectation.isError)}, actual ${String(result.isError)}`)
    }
    if (expectation.contains !== undefined && !result.text.includes(expectation.contains)) {
      failures.push(`contains ${JSON.stringify(expectation.contains)} not found in the result text`)
    }
    if (expectation.regex !== undefined && !new RegExp(expectation.regex, 'u').test(result.text)) {
      failures.push(`regex /${expectation.regex}/ did not match the result text`)
    }
    if (failures.length === 0) {
      push({ id, kind: 'tool result', passed: true, expected: `${expectation.tool}#${expectation.index}`, actual: result.text.slice(0, 200) })
    } else {
      push({
        id,
        kind: 'tool result',
        passed: false,
        expected: `${expectation.tool}#${expectation.index}: ${failures.join('; ')}`,
        actual: result.text.slice(0, 200) || '(empty result)',
      })
    }
  })
  // Final-output assertions.
  const output = caze.expect.output
  if (output !== undefined) {
    const text = trace.finalOutput
    if (output.contains !== undefined) {
      push({
        id: 'output.contains',
        kind: 'final output',
        passed: text.includes(output.contains),
        expected: `contains ${JSON.stringify(output.contains)}`,
        actual: text.slice(0, 200) || '(no final output)',
      })
    }
    if (output.notContains !== undefined) {
      push({
        id: 'output.notContains',
        kind: 'final output',
        passed: !text.includes(output.notContains),
        expected: `does not contain ${JSON.stringify(output.notContains)}`,
        actual: text.slice(0, 200) || '(no final output)',
      })
    }
    if (output.regex !== undefined) {
      push({
        id: 'output.regex',
        kind: 'final output',
        passed: new RegExp(output.regex, 'u').test(text),
        expected: `matches /${output.regex}/`,
        actual: text.slice(0, 200) || '(no final output)',
      })
    }
    if (output.notRegex !== undefined) {
      push({
        id: 'output.notRegex',
        kind: 'final output',
        passed: !new RegExp(output.notRegex, 'u').test(text),
        expected: `does not match /${output.notRegex}/`,
        actual: text.slice(0, 200) || '(no final output)',
      })
    }
  }
  // Turn-end gate.
  push({
    id: 'turnEnds',
    kind: 'turn outcome',
    passed: caze.expect.turnEnds === 'any' || trace.turnEnd?.kind === 'completed',
    expected: `turn ends ${caze.expect.turnEnds === 'any' ? 'any way' : 'completed'}`,
    actual: `turn ended ${trace.turnEnd?.kind ?? '(no turn recorded)'}`,
  })
  // Token budget.
  if (caze.expect.maxTokens !== undefined) {
    const tokens = trace.tokenUsage?.outputTokens
    push({
      id: 'maxTokens',
      kind: 'token budget',
      passed: tokens !== undefined && tokens <= caze.expect.maxTokens,
      expected: `output tokens ≤ ${caze.expect.maxTokens}`,
      actual: tokens === undefined ? '(adapter reported no usage)' : `${tokens} output tokens`,
    })
  }
  // Prompt regression (side-by-side diff against a baseline).
  const prompt = caze.expect.prompt
  if (prompt !== undefined) {
    const baseline = prompt.baseline ?? promptBaselines?.get(caze.id)
    const actual = trace.requestHeader?.system
    const allowedChanges = prompt.allowedChanges ?? []
    if (actual === undefined) {
      push({
        id: 'prompt.diff',
        kind: 'prompt regression',
        passed: false,
        expected: baseline === undefined ? 'a resolved prompt baseline' : 'the captured system prompt',
        actual: 'no system prompt captured (the log had no request/header event)',
      })
    } else if (baseline === undefined) {
      push({
        id: 'prompt.diff',
        kind: 'prompt regression',
        passed: false,
        expected: 'a resolved prompt baseline',
        actual: `baseline not resolved for "${caze.id}" (inline baseline or a resolved baselineFrom is required)`,
      })
    } else {
      const rows = diffLines(baseline, actual)
      const changeRows = rows.filter(row => row.kind !== 'unchanged')
      const unWhitelisted = changeRows.filter(row => {
        const text = row.kind === 'removed' ? row.baseline ?? '' : row.actual ?? ''
        return !allowedChanges.some(source => new RegExp(source, 'u').test(text))
      })
      push({
        id: 'prompt.diff',
        kind: 'prompt regression',
        passed: !hasChanges(rows) || unWhitelisted.length === 0,
        expected: `system prompt matches the baseline (${baseline.split('\n').length} line(s))`,
        actual: hasChanges(rows)
          ? `${unWhitelisted.length} changed line(s) not covered by the allowedChanges whitelist`
          : 'system prompt matches the baseline',
        detail: renderSideBySide(rows),
      })
    }
  }
  // Stress metrics (P99 latency, TTFT, token speed).
  const stress = caze.expect.stress
  if (stress !== undefined) {
    const metrics = computeStressMetrics(trace.steps ?? [])
    const noTiming = metrics.stepCount === 0
    if (stress.maxP99Ms !== undefined) {
      push({
        id: 'stress.p99',
        kind: 'stress metric',
        passed: metrics.p99Ms !== undefined && metrics.p99Ms <= stress.maxP99Ms,
        expected: `P99 step latency ≤ ${stress.maxP99Ms} ms`,
        actual: metrics.p99Ms === undefined
          ? noTiming ? 'no step timing recorded' : 'steps recorded no latency window'
          : `${metrics.p99Ms} ms P99`,
      })
    }
    if (stress.maxTtftMs !== undefined) {
      push({
        id: 'stress.ttft',
        kind: 'stress metric',
        passed: metrics.ttftMaxMs !== undefined && metrics.ttftMaxMs <= stress.maxTtftMs,
        expected: `time-to-first-token ≤ ${stress.maxTtftMs} ms`,
        actual: metrics.ttftMaxMs === undefined
          ? noTiming ? 'no step timing recorded' : 'no first-token time recorded'
          : `${metrics.ttftMaxMs} ms worst TTFT`,
      })
    }
    if (stress.minTokensPerSecond !== undefined) {
      push({
        id: 'stress.tokensPerSecond',
        kind: 'stress metric',
        passed: metrics.tokensPerSecond !== undefined && metrics.tokensPerSecond >= stress.minTokensPerSecond,
        expected: `token generation speed ≥ ${stress.minTokensPerSecond} tokens/second`,
        actual: metrics.tokensPerSecond === undefined
          ? noTiming ? 'no step timing recorded' : 'no generation window recorded'
          : `${metrics.tokensPerSecond.toFixed(1)} tokens/second`,
      })
    }
  }
  // Bias radar (fairness assertions over the final output).
  const bias = caze.expect.bias
  if (bias !== undefined) {
    const text = trace.finalOutput
    const counts = biasCategoryCounts(text, bias.categories)
    const totalHits = [...counts.values()].reduce((sum, count) => sum + count, 0)
    if (bias.forbid.length > 0) {
      const forbidden = countRegexMatches(text, bias.forbid)
      push({
        id: 'bias.forbid',
        kind: 'bias radar',
        passed: forbidden === 0,
        expected: `none of the ${bias.forbid.length} forbidden pattern(s) match`,
        actual: forbidden === 0 ? 'no forbidden match' : `${forbidden} forbidden match(es)`,
      })
    }
    if (Object.keys(bias.categories).length > 0) {
      const over = [...counts.entries()].filter(([, count]) => bias.maxCategoryHits !== undefined && count > bias.maxCategoryHits)
      push({
        id: 'bias.radar',
        kind: 'bias radar',
        passed: bias.maxCategoryHits === undefined || over.length === 0,
        expected: bias.maxCategoryHits === undefined
          ? 'bias categories counted'
          : `each bias category ≤ ${bias.maxCategoryHits} hit(s)`,
        actual: renderRadar(counts),
        ...(over.length > 0 ? { detail: `categories over the cap: ${over.map(([category, count]) => `${category}: ${count}`).join(', ')}` } : {}),
      })
    }
    if (bias.maxHits !== undefined) {
      push({
        id: 'bias.total',
        kind: 'bias radar',
        passed: totalHits <= bias.maxHits,
        expected: `total bias hits ≤ ${bias.maxHits}`,
        actual: `${totalHits} total hit(s) (${renderRadar(counts)})`,
      })
    }
  }
  return results
}
