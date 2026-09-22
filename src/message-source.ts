/**
 * Message-source declaration for the notices `dsh-auto-review` injects.
 *
 * The host's `MessageSourceMap` is a merge-extensible sum type with no
 * catch-all `plugin` kind: each producer declares its own `kind` in its own
 * module, and the durable-log admission path
 * (`session-format-v3-to-v4/src/message-sources.ts`) REFUSES a row whose
 * source is literally `kind: 'plugin'` — the rejection is physical, so not
 * even a cast gets such a row past it. This module declares the plugin's own
 * kind, and every writer imports it for its type side effect.
 *
 * Form note: the two notices below are one-line accounts of what happened, so
 * they carry `form: 'notice'` plus the `summary` that form requires. The
 * summary is the persisted one-line record of the notice; the injected text
 * block stays complete, because that is what the model reads.
 *
 * Upgrade note: a V3 session's `plugin:auto-review`-namespaced history is NOT
 * re-read by this plugin (it folds only its own `autoReview/*` events), so the
 * three durable spellings — `{ kind: 'auto-review' }`, the V3→V4 migration's
 * `plugin:auto-review` event namespace, and the retired
 * `{ kind: 'plugin', plugin: 'auto-review' }` source — only need to remain
 * LOADABLE, which the host's own migration guarantees. Nothing here folds
 * messages by source, so no back-compat branch is required.
 * @module dsh-auto-review/message-source
 */
import type { ContextFormed as DshContextFormed } from '@deepseek-ai/dsh-llm/message'

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap {
    /** A session notice `dsh-auto-review` injected (the `/auto-review on|off` switch and the circuit-breaker abort warning). */
    'auto-review': { kind: 'auto-review' } & DshContextFormed
  }
}

export {}
