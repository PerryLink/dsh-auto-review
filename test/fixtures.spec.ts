/**
 * Config-fixture regression: every shipped YAML example must survive the real
 * Schemastery schema and `resolveConfig` (the examples are documentation, but
 * a `(?i)` PCRE flag or a double-escaped `\\s` makes them unloadable).
 * @module dsh-auto-review/test/fixtures.spec
 */

import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { Config, resolveConfig } from '../src/index.ts'

const FILES = [
  'fixtures/config/config-full.yaml',
  'fixtures/config/config-strict.yaml',
] as const

describe('shipped config fixtures', () => {
  for (const file of FILES) {
    it(`parses and resolves ${file}`, () => {
      const raw = parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')) as Record<string, unknown>
      const validated = Config(raw)
      const resolved = resolveConfig(validated)
      expect(resolved.riskRules.length).toBeGreaterThan(0)
      expect(['agent', 'phocinae']).toContain(resolved.reviewerBackend)
    })
  }
})
