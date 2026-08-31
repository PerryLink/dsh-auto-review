/**
 * Config tests: schema defaults, explicit resolution, and fail-loud
 * validation (invalid regexes, invalid enum values, out-of-range budgets),
 * plus the function-plugin Loader contract (no default export).
 * @module dsh-auto-review/test/config.spec
 */

import { describe, expect, it } from 'vitest'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { Config as ConfigSchema, DEFAULT_CONTEXT_TURNS, hasAiPolicy, resolveConfig } from '../src/index.ts'
import * as plugin from '../src/index.ts'
import { mountHarness } from './harness.ts'

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
      verdictCacheTtlMs: 60_000,
      verdictCacheMaxEntries: 256,
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
    expect(resolved.contextBudget).toEqual({ turns: DEFAULT_CONTEXT_TURNS, maxChars: 4000 })
    expect(resolved.riskPolicy).toEqual({ maxAutoAllow: 'high', onHighRisk: 'delegate' })
    expect(resolved.circuitBreaker).toEqual({ consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: 'delegate' })
    expect(resolved.overrideTtlMs).toBe(5 * 60_000)
    expect(resolved.reviewerPolicyText).toBeUndefined()
    expect(resolved.language).toBe('en')
  })

  it('gives the reviewer a transcript by default, so it can see the request it is judging', () => {
    // turns: 0 leaves the reviewer with no evidence but the calling agent's
    // self-report, and its own verdict rule ("when unsure, DENY") then denies
    // every user-authorized action. The default must be non-zero.
    expect(DEFAULT_CONTEXT_TURNS).toBeGreaterThan(0)
    expect(resolveConfig().contextBudget.turns).toBe(DEFAULT_CONTEXT_TURNS)
    expect(ConfigSchema({}).contextBudget?.turns).toBe(DEFAULT_CONTEXT_TURNS)
    // An explicit 0 is still honored — it is a documented opt-out, and the
    // runtime warns about it at mount time rather than silently denying.
    expect(resolveConfig({ contextBudget: { turns: 0 } }).contextBudget.turns).toBe(0)
  })

  it('warns at mount when an ai policy is combined with an empty context budget', async () => {
    const blind = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } }, contextBudget: { turns: 0 } })
    expect(blind.warnings.join('\n')).toContain('contextBudget.turns is 0')
    // Neither half alone is the deny-everything configuration.
    const noAi = await mountHarness({ contextBudget: { turns: 0 } })
    expect(noAi.warnings.join('\n')).not.toContain('contextBudget.turns is 0')
    const withTranscript = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    expect(withTranscript.warnings.join('\n')).not.toContain('contextBudget.turns is 0')
  })

  it('recognizes the configurations that can reach the AI reviewer', () => {
    expect(hasAiPolicy(resolveConfig())).toBe(false)
    expect(hasAiPolicy(resolveConfig({ toolsPolicy: { default: 'ai' } }))).toBe(true)
    expect(hasAiPolicy(resolveConfig({ toolsPolicy: { overrides: { bash: 'ai' } } }))).toBe(true)
    expect(hasAiPolicy(resolveConfig({ riskRules: [{ pattern: 'rm', policy: 'ai' }] }))).toBe(true)
    expect(hasAiPolicy(resolveConfig({ toolsPolicy: { overrides: { bash: 'never' } } }))).toBe(false)
  })

  it('defaults the verdict cache and accepts 0 as off', () => {
    expect(resolveConfig().verdictCacheTtlMs).toBe(60_000)
    expect(resolveConfig().verdictCacheMaxEntries).toBe(256)
    expect(resolveConfig({ verdictCacheTtlMs: 0 }).verdictCacheTtlMs).toBe(0)
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
    expect(() => resolveConfig({ verdictCacheTtlMs: -1 })).toThrow(/verdictCacheTtlMs/u)
    expect(() => resolveConfig({ verdictCacheMaxEntries: 0 })).toThrow(/verdictCacheMaxEntries/u)
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
    // The Loader unwraps `exports.default ?? exports`; the namespace must
    // survive that round-trip with name/inject/Config/apply intact.
    const loader = Object.create(Loader.prototype)
    const unwrapped = loader.unwrapExports(plugin)
    expect(unwrapped).toBe(plugin)
    expect(unwrapped.name).toBe('auto-review')
    expect(unwrapped.inject).toEqual(['approval', 'subagents', 'commands', 'tools'])
  })
})
