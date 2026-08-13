/**
 * Config tests: schema defaults, explicit resolution, and fail-loud
 * validation (invalid regexes, invalid enum values, out-of-range budgets),
 * plus the function-plugin Loader contract (no default export).
 * @module dsh-auto-review/test/config.spec
 */

import { describe, expect, it } from 'vitest'
import { Config as ConfigSchema, resolveConfig } from '../src/index.ts'
import * as plugin from '../src/index.ts'

describe('config resolution', () => {
  it('applies conservative defaults', () => {
    const resolved = resolveConfig()
    expect(resolved).toMatchObject({
      enableByDefault: true,
      toolsPolicy: { default: 'human', overrides: {} },
      reviewerProvider: 'fork',
      reviewerTimeoutMs: 60_000,
      reviewerTools: ['read', 'glob', 'grep'],
      fallbackPolicy: 'rejected',
      maxReviewsPerTurn: 10,
      reasonMaxChars: 2000,
    })
    expect(resolved.riskRules).toEqual([])
    expect(resolved.reviewerModel).toBeUndefined()
  })

  it('compiles risk rules into flagless regexes in order', () => {
    const resolved = resolveConfig({
      riskRules: [
        { pattern: 'killall', policy: 'never' },
        { pattern: 'curl', policy: 'human' },
      ],
    })
    expect(resolved.riskRules.map(rule => rule.policy)).toEqual(['never', 'human'])
    expect(resolved.riskRules[0]!.regex.test('run killall now')).toBe(true)
    expect(resolved.riskRules[0]!.regex.flags).toBe('u')
    // Flagless: repeated .test() calls stay stateless.
    expect(resolved.riskRules[0]!.regex.test('killall')).toBe(true)
    expect(resolved.riskRules[0]!.regex.test('killall')).toBe(true)
  })

  it('fails loud on an invalid risk-rule regex', () => {
    expect(() => resolveConfig({ riskRules: [{ pattern: '(', policy: 'never' }] })).toThrow(/not a valid regular expression/u)
  })

  it('fails loud on invalid budgets', () => {
    expect(() => resolveConfig({ reviewerTimeoutMs: 0 })).toThrow(/reviewerTimeoutMs/u)
    expect(() => resolveConfig({ reviewerTimeoutMs: 1.5 })).toThrow(/reviewerTimeoutMs/u)
    expect(() => resolveConfig({ maxReviewsPerTurn: -1 })).toThrow(/maxReviewsPerTurn/u)
    expect(() => resolveConfig({ reasonMaxChars: 0 })).toThrow(/reasonMaxChars/u)
  })

  it('keeps partial overrides and defaults the rest of the table', () => {
    const resolved = resolveConfig({ toolsPolicy: { overrides: { bash: 'ai' } } })
    expect(resolved.toolsPolicy).toEqual({ default: 'human', overrides: { bash: 'ai' } })
  })
})

describe('config schema', () => {
  it('validates and fills defaults from a raw object', () => {
    const filled = ConfigSchema({ toolsPolicy: { overrides: { bash: 'ai' } } })
    expect(filled.toolsPolicy?.default).toBe('human')
    expect(filled.fallbackPolicy).toBe('rejected')
  })

  it('rejects an invalid policy value', () => {
    expect(() => ConfigSchema({ toolsPolicy: { overrides: { bash: 'maybe' } } } as never)).toThrow()
  })

  it('rejects an invalid fallback policy', () => {
    expect(() => ConfigSchema({ fallbackPolicy: 'grant-all' } as never)).toThrow()
  })
})

describe('plugin module contract', () => {
  it('is a function plugin with no default export (Loader unwrap safety)', () => {
    expect('default' in plugin).toBe(false)
    expect(plugin.name).toBe('auto-review')
    expect(plugin.inject).toEqual(['approval', 'subagents', 'commands', 'tools'])
    expect(typeof plugin.apply).toBe('function')
    expect(plugin.Config).toBeDefined()
  })
})
