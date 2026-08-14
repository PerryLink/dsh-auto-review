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
      maxFailuresPerTurn: 10,
      reasonMaxChars: 2000,
    })
    expect(resolved.riskRules).toEqual([])
    expect(resolved.reviewerModel).toBeUndefined()
  })

  it('defaults maxFailuresPerTurn to maxReviewsPerTurn when only the latter is set', () => {
    expect(resolveConfig({ maxReviewsPerTurn: 3 }).maxFailuresPerTurn).toBe(3)
    expect(resolveConfig({ maxFailuresPerTurn: 2 }).maxFailuresPerTurn).toBe(2)
  })

  it('accepts the renamed allow-once fallback and rejects the old spelling', () => {
    expect(resolveConfig({ fallbackPolicy: 'allow-once' }).fallbackPolicy).toBe('allow-once')
    expect(() => ConfigSchema({ fallbackPolicy: 'allow-readonly' } as never)).toThrow()
  })

  it('defaults the Phase B tunables conservatively', () => {
    const resolved = resolveConfig()
    expect(resolved.denyGuidance).toContain('Do not attempt')
    expect(resolved.contextBudget).toEqual({ turns: 0, maxChars: 4000 })
    expect(resolved.riskPolicy).toEqual({ maxAutoAllow: 'high', onHighRisk: 'delegate' })
    expect(resolved.circuitBreaker).toEqual({ consecutiveDenies: 3, windowDenies: 10, windowSize: 50, action: 'delegate' })
    expect(resolved.overrideTtlMs).toBe(5 * 60_000)
    expect(resolved.reviewerPolicyText).toBeUndefined()
    expect(resolved.language).toBe('en')
  })

  it('rejects an unsupported UI language', () => {
    expect(() => ConfigSchema({ language: 'fr' } as never)).toThrow()
  })

  it('compiles risk rules with their match field', () => {
    const resolved = resolveConfig({
      riskRules: [
        { pattern: 'bash', policy: 'never', field: 'toolName' },
        { pattern: 'killall', policy: 'human' },
      ],
    })
    expect(resolved.riskRules.map(rule => rule.field)).toEqual(['toolName', 'reason'])
  })

  it('fails loud on an empty reviewerTools allow-list', () => {
    expect(() => resolveConfig({ reviewerTools: [] })).toThrow(/reviewerTools/u)
  })

  it('fails loud on invalid circuit/context/override budgets', () => {
    expect(() => resolveConfig({ circuitBreaker: { windowSize: 0 } })).toThrow(/circuitBreaker\.windowSize/u)
    expect(() => resolveConfig({ contextBudget: { turns: -1 } })).toThrow(/contextBudget\.turns/u)
    expect(() => resolveConfig({ overrideTtlMs: 0 })).toThrow(/overrideTtlMs/u)
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
    expect(() => resolveConfig({ maxFailuresPerTurn: 0 })).toThrow(/maxFailuresPerTurn/u)
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
