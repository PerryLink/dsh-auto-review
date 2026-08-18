/**
 * Real Loader composition + built-artifact suite (community five-layer model,
 * layers 4–5). An independent process mounts the vendored Loader over a
 * cordis.yml with real service rows + the plugin row + config, proving module
 * unwrapping, inject resolution, config application, and the answerer's
 * registry contribution — paths a hand-built `ctx.plugin` assembly never
 * exercises. It also carries the two negative regressions (invalid config
 * fails loud, a default export fails with the missing-inject reason) and the
 * `dsh-eval` built-bin smoke, all against the `lib/` artifact.
 * @module dsh-auto-review/test/composition.spec
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runner = join(repositoryRoot, 'scripts', 'loader-runner.mjs')
const builtEntry = join(repositoryRoot, 'lib', 'index.js')

/** One cordis.yml: real service rows, then the plugin row with config. */
function configFor(pluginRow: string, configLines: string[] = []): string {
  return [
    "- name: '@deepseek-ai/dsh-session'",
    "- name: '@deepseek-ai/dsh-user-approval'",
    "- name: '@deepseek-ai/dsh-commands'",
    `- name: ${JSON.stringify(pluginRow)}`,
    ...(configLines.length > 0 ? ['  config:', ...configLines.map(line => `    ${line}`)] : []),
    '',
  ].join('\n')
}

function run(command: string, args: string[], cwd: string, shell = false, timeout = 120_000) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env },
    timeout,
    shell,
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-auto-review-loader-'))

beforeAll(() => {
  const build = run('pnpm', ['run', 'build'], repositoryRoot, process.platform === 'win32')
  if (build.status !== 0) {
    throw new Error(`pnpm run build failed (${String(build.status)})\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`)
  }
}, 120_000)

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true })
})

describe('real Loader composition', () => {
  it('mounts the answerer and applies the never policy through the Loader', () => {
    const configPath = join(temporaryRoot, 'valid.yml')
    writeFileSync(configPath, configFor(pathToFileURL(builtEntry).href, ['toolsPolicy:', '  default: never']))
    const evidence = run(process.execPath, [runner, configPath, 'answerer'], repositoryRoot)
    expect(evidence.status, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`).toBe(0)
    expect(evidence.stdout).toMatch(/DSH_LOADER_RESULT/u)
    const marker = evidence.stdout.match(/DSH_LOADER_RESULT (.+)$/mu)
    const summary = JSON.parse(marker![1]!) as { command: string; outcome: string }
    expect(summary.command).toBe('auto-review')
    expect(summary.outcome).toBe('rejected')
  })

  it('rejects a non-policy toolsPolicy value through the Loader schema', () => {
    const configPath = join(temporaryRoot, 'invalid-policy.yml')
    writeFileSync(configPath, configFor(pathToFileURL(builtEntry).href, ['toolsPolicy:', '  default: bogus']))
    const evidence = run(process.execPath, [runner, configPath, 'answerer'], repositoryRoot)
    expect(evidence.status, `invalid config unexpectedly mounted:\n${evidence.stderr}`).not.toBe(0)
    expect(evidence.stderr).toMatch(/toolsPolicy|union|expected|ai|human|never/u)
  })

  it('fails loud on an out-of-range budget at resolveConfig through the Loader', () => {
    const configPath = join(temporaryRoot, 'invalid-budget.yml')
    writeFileSync(configPath, configFor(pathToFileURL(builtEntry).href, ['reviewerTimeoutMs: 0']))
    const evidence = run(process.execPath, [runner, configPath, 'answerer'], repositoryRoot)
    expect(evidence.status, `invalid config unexpectedly mounted:\n${evidence.stderr}`).not.toBe(0)
    expect(evidence.stderr).toMatch(/reviewerTimeoutMs/u)
  })

  it('a default export fails through the Loader with the missing-inject reason', () => {
    const wrapper = join(temporaryRoot, 'default-export.mjs')
    const builtUrl = pathToFileURL(builtEntry).href
    writeFileSync(wrapper, [
      `export { name, inject, Config, apply } from ${JSON.stringify(builtUrl)}`,
      `export { apply as default } from ${JSON.stringify(builtUrl)}`,
      '',
    ].join('\n'))
    const configPath = join(temporaryRoot, 'invalid-default.yml')
    writeFileSync(configPath, configFor(pathToFileURL(wrapper).href))
    const evidence = run(process.execPath, [runner, configPath, 'answerer'], repositoryRoot)
    expect(evidence.status, 'default-export wrapper unexpectedly mounted').not.toBe(0)
    expect(evidence.stderr).toMatch(/without inject/u)
  })
})

describe('built bin smoke', () => {
  it('runs the dsh-eval bin over the built lib and prints its usage', () => {
    const evidence = run(process.execPath, [join(repositoryRoot, 'bin', 'dsh-eval.mjs'), '--help'], repositoryRoot)
    expect(evidence.status, `stdout:\n${evidence.stdout}\nstderr:\n${evidence.stderr}`).toBe(0)
    expect(evidence.stdout).toContain('Usage: dsh-eval')
  })
})
