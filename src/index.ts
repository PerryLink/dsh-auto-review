/**
 * `dsh-auto-review` — second-model AI auto-review for DeepSeek Harness
 * approval requests. Registers an answerer on the `approval/request`
 * waterfall that, when a session has auto-review enabled and the configured
 * tool/risk policy says `ai`, runs a read-only one-shot reviewer subagent
 * (`toolFilter` allow-list, structured verdict schema) and settles the
 * request from its verdict; every other request delegates via `next()` to
 * the human answerer chain. Failures fall back per `fallbackPolicy` (default
 * fail-closed `rejected`).
 *
 * Function plugin — no default export (the Loader unwraps
 * `exports.default ?? exports`, and a stray default would discard
 * `name`/`inject`/`Config`/`apply`).
 * @module dsh-auto-review
 */

import { apply } from './runtime.ts'
import type { AutoReviewRuntime } from './runtime.ts'

export const name = 'auto-review'
export const inject = ['approval', 'subagents', 'commands', 'tools']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The mounted auto-review runtime (resolved config + answerer), provided by `apply`. */
    autoReviewRuntime: AutoReviewRuntime
  }
}

export { apply }
export { AutoReviewRuntime } from './runtime.ts'
export * from './config.ts'
export * from './events.ts'
export * from './review.ts'
export * from './projection.ts'
export * from './projection-types.ts'
