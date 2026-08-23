/**
 * DSL tests: YAML parsing, schema validation, and model/timeout resolution.
 * @module dsh-auto-review/test/eval/dsl
 */

import { describe, expect, it } from 'vitest'
import { DslError, parseSuite, resolveCaseModel, resolveCaseTimeout } from '../../src/eval/dsl.ts'
import type { EvalCase, EvalSuite } from '../../src/eval/dsl.ts'

const MINIMAL = `
suite:
  name: demo
  cases:
    - id: a
      input: do it
`

describe('parseSuite', () => {
  it('parses the wrapped suite: document shape', () => {
    const suite = parseSuite(MINIMAL)
    expect(suite.name).toBe('demo')
    expect(suite.cases).toHaveLength(1)
    expect(suite.cases[0]?.input).toBe('do it')
  })

  it('parses the bare mapping shape too', () => {
    const suite = parseSuite('name: bare\ncases:\n  - id: x\n    input: y\n')
    expect(suite.name).toBe('bare')
  })

  it('applies expectation defaults', () => {
    const suite = parseSuite(MINIMAL)
    const caze = suite.cases[0] as EvalCase
    expect(caze.expect.toolCalls).toEqual([])
    expect(caze.expect.results).toEqual([])
    expect(caze.expect.turnEnds).toBe('completed')
    expect(suite.models.tiers).toEqual({})
  })

  it('rejects YAML syntax errors with the source path', () => {
    expect(() => parseSuite('name: [unclosed', 'x.yaml')).toThrow(DslError)
    expect(() => parseSuite('name: [unclosed', 'x.yaml')).toThrow(/x\.yaml/u)
  })

  it('rejects non-mapping documents', () => {
    expect(() => parseSuite('- just\n- a\n- list\n')).toThrow(DslError)
  })

  it('rejects a suite without cases', () => {
    expect(() => parseSuite('name: empty\ncases: []\n')).toThrow(/cases/u)
  })

  it('rejects duplicate case ids', () => {
    expect(() => parseSuite('name: dup\ncases:\n  - {id: a, input: "1"}\n  - {id: a, input: "2"}\n')).toThrow(/unique/u)
  })

  it('rejects a case with both model and tier', () => {
    expect(() => parseSuite('name: m\ncases:\n  - {id: a, input: "1", model: x, tier: fast}\n')).toThrow(/model.*tier/u)
  })

  it('rejects an argument expectation with two matcher kinds', () => {
    const yaml = [
      'name: m',
      'cases:',
      '  - id: a',
      '    input: "1"',
      '    expect:',
      '      toolCalls:',
      '        - tool: glob',
      '          arguments:',
      '            contains: {pattern: x}',
      '            equals: {pattern: x}',
    ].join('\n')
    expect(() => parseSuite(yaml)).toThrow(/exactly one/u)
  })

  it('rejects escaping workspace seed paths', () => {
    const yaml = 'name: m\ncases:\n  - id: a\n    input: "1"\n    files:\n      - {path: ../evil.txt}\n'
    expect(() => parseSuite(yaml)).toThrow(/files/u)
  })

  it('rejects an empty review statement', () => {
    const yaml = 'name: m\ncases:\n  - id: a\n    input: "1"\n    review:\n      statement: ""\n'
    expect(() => parseSuite(yaml)).toThrow(/statement/u)
  })

  it('parses a prompt-regression expectation with a baseline and whitelist', () => {
    const suite = parseSuite('name: m\ncases:\n  - id: a\n    input: "1"\n    expect:\n      prompt:\n        baseline: "You are a helpful software engineer assistant."\n        allowedChanges: ["copyright"]\n')
    expect(suite.cases[0]?.expect.prompt?.baseline).toContain('software engineer')
    expect(suite.cases[0]?.expect.prompt?.allowedChanges).toEqual(['copyright'])
  })

  it('rejects a prompt expectation with neither baseline nor baselineFrom (and both)', () => {
    expect(() => parseSuite('name: m\ncases:\n  - id: a\n    input: "1"\n    expect:\n      prompt: {allowedChanges: [x]}\n')).toThrow(/baseline/u)
    expect(() => parseSuite('name: m\ncases:\n  - id: a\n    input: "1"\n    expect:\n      prompt: {baseline: "a", baselineFrom: "b.txt"}\n')).toThrow(/exactly one/u)
  })

  it('parses a stress expectation and rejects an empty one', () => {
    const suite = parseSuite('name: m\ncases:\n  - id: a\n    input: "1"\n    expect:\n      stress: {maxP99Ms: 2000, minTokensPerSecond: 5}\n')
    expect(suite.cases[0]?.expect.stress?.maxP99Ms).toBe(2000)
    expect(() => parseSuite('name: m\ncases:\n  - id: a\n    input: "1"\n    expect:\n      stress: {}\n')).toThrow(/stress/u)
  })

  it('parses a bias expectation with categories, forbid, and caps', () => {
    const suite = parseSuite('name: m\ncases:\n  - id: a\n    input: "1"\n    expect:\n      bias:\n        categories:\n          gender: ["(?:he|she) is (?:un)?stable"]\n        forbid: ["man up"]\n        maxHits: 2\n        maxCategoryHits: 1\n')
    const bias = suite.cases[0]?.expect.bias
    expect(bias?.categories.gender).toHaveLength(1)
    expect(bias?.forbid).toEqual(['man up'])
    expect(bias?.maxHits).toBe(2)
  })

  it('rejects maxCategoryHits without categories and an empty bias block', () => {
    expect(() => parseSuite('name: m\ncases:\n  - id: a\n    input: "1"\n    expect:\n      bias: {maxCategoryHits: 1}\n')).toThrow(/category/u)
    expect(() => parseSuite('name: m\ncases:\n  - id: a\n    input: "1"\n    expect:\n      bias: {}\n')).toThrow(/bias/u)
  })
})

describe('resolveCaseModel', () => {
  const suite = parseSuite(`
name: m
models:
  default: suite-default
  tiers:
    fast: tier-fast
cases:
  - id: a
    input: "1"
`) as EvalSuite
  const table = { provider: 'p', cliModel: 'cli-default', cliTiers: { fast: 'cli-fast', other: 'cli-other' } }
  const caze = suite.cases[0] as EvalCase

  it('prefers the case model', () => {
    expect(resolveCaseModel({ ...caze, model: 'case-model' } as EvalCase, suite, table)).toBe('case-model')
  })

  it('resolves tiers through the CLI table first, then the suite table', () => {
    expect(resolveCaseModel({ ...caze, tier: 'fast' } as EvalCase, suite, table)).toBe('cli-fast')
    expect(resolveCaseModel({ ...caze, tier: 'other' } as EvalCase, suite, table)).toBe('cli-other')
    expect(resolveCaseModel({ ...caze, tier: 'fast' } as EvalCase, suite, { ...table, cliTiers: {} })).toBe('tier-fast')
  })

  it('falls back to the suite default, then the CLI default, then undefined', () => {
    expect(resolveCaseModel(caze, suite, table)).toBe('suite-default')
    const noDefault = parseSuite('name: m\ncases:\n  - {id: a, input: "1"}\n') as EvalSuite
    expect(resolveCaseModel(noDefault.cases[0] as EvalCase, noDefault, table)).toBe('cli-default')
    expect(resolveCaseModel(noDefault.cases[0] as EvalCase, noDefault, { provider: 'p', cliTiers: {} })).toBeUndefined()
  })
})

describe('resolveCaseTimeout', () => {
  const suite = parseSuite('name: m\ntimeoutMs: 1000\ncases:\n  - {id: a, input: "1"}\n  - {id: b, input: "2", timeoutMs: 500}\n') as EvalSuite
  const a = suite.cases[0] as EvalCase
  const b = suite.cases[1] as EvalCase

  it('prefers case, then suite, then CLI, then undefined', () => {
    expect(resolveCaseTimeout(a, suite, 2000)).toBe(1000)
    expect(resolveCaseTimeout(b, suite, 2000)).toBe(500)
    expect(resolveCaseTimeout(a, { ...suite, timeoutMs: undefined }, 2000)).toBe(2000)
    expect(resolveCaseTimeout(a, { ...suite, timeoutMs: undefined })).toBeUndefined()
  })
})
