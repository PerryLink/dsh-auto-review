/**
 * CLI tests: flag parsing and the gate/usage exit-code paths (the boot path
 * is exercised by the real-model demo, not here).
 * @module dsh-auto-review/test/eval/cli
 */

import { describe, expect, it } from 'vitest'
import { CliError, HelpRequested, VersionRequested, parseFlags } from '../../src/eval/cli.ts'

describe('parseFlags', () => {
  it('collects suite paths and defaults', () => {
    const flags = parseFlags(['a.yaml', 'b/', '--model', 'm1'])
    expect(flags.suitePaths).toEqual(['a.yaml', 'b/'])
    expect(flags.model).toBe('m1')
    expect(flags.out).toBe('.eval-reports')
    expect(flags.concurrency).toBeUndefined()
    expect(flags.noGate).toBe(false)
    expect(flags.tiers).toEqual({})
  })

  it('parses tier mappings, integers, and equals-flag syntax', () => {
    const flags = parseFlags(['--tier', 'fast=m1', '--tier=pro=m2', '--timeout-ms', '500', '--concurrency=3', 'x.yaml'])
    expect(flags.tiers).toEqual({ fast: 'm1', pro: 'm2' })
    expect(flags.timeoutMs).toBe(500)
    expect(flags.concurrency).toBe(3)
  })

  it('rejects malformed tiers and integers', () => {
    expect(() => parseFlags(['--tier', 'nomodel', 'x.yaml'])).toThrow(CliError)
    expect(() => parseFlags(['--timeout-ms', 'fast', 'x.yaml'])).toThrow(CliError)
    expect(() => parseFlags(['--timeout-ms', '0', 'x.yaml'])).toThrow(CliError)
  })

  it('rejects unknown flags and a missing suite path', () => {
    expect(() => parseFlags(['--wat', 'x.yaml'])).toThrow(CliError)
    expect(() => parseFlags(['--model', 'm'])).toThrow(/no suite path/u)
  })

  it('raises the help and version markers', () => {
    expect(() => parseFlags(['--help'])).toThrow(HelpRequested)
    expect(() => parseFlags(['-h'])).toThrow(HelpRequested)
    expect(() => parseFlags(['--version'])).toThrow(VersionRequested)
  })

  it('parses review overrides', () => {
    const flags = parseFlags(['--review-provider', 'spawn', '--review-model', 'm9', '--review-timeout-ms', '42', 'x.yaml'])
    expect(flags.reviewProvider).toBe('spawn')
    expect(flags.reviewModel).toBe('m9')
    expect(flags.reviewTimeoutMs).toBe(42)
  })
})
