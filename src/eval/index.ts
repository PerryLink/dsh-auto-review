/**
 * The dsh-eval engine face: YAML case DSL, trace collection, structured
 * assertions, second-model review, the isolated headless-session runner,
 * and the JSON/Markdown report writers. Library consumers compose these
 * directly; the `dsh-eval` CLI (`dsh-auto-review/eval-cli`) boots the
 * shipped `eval/cordis.yml` composition and drives the engine.
 * @module dsh-auto-review/eval
 */

export * from './dsl.ts'
export * from './trace.ts'
export * from './diff.ts'
export * from './stress.ts'
export * from './assert.ts'
export * from './review.ts'
export * from './runner.ts'
export * from './report.ts'
