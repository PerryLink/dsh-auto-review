/**
 * `dsh-auto-review`, browser half: registers the locale dictionaries, the
 * scoped stylesheet, and the session-header review panel action. All data
 * arrives through the `autoReview` session projection; the approve buttons
 * execute the `/auto-review approve [n]` command through the commands
 * Remote namespace.
 *
 * @module dsh-auto-review/client
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the 'conversation.session.header.actions' SlotMap
// declaration into this program so the registration typechecks.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: merges the commands namespace onto ctx.remote.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '../projection-types.ts'
import { ReviewPanel, type ReviewPanelInjected } from './ReviewPanel.tsx'
import { en, NS, zh, type ReviewPanelLocaleKey } from './locales.ts'
import { installPanelStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Review panel copy. */
    'autoReviewPanel': ReviewPanelLocaleKey
  }
}

export type { ReviewPanelProps, ReviewPanelInjected } from './ReviewPanel.tsx'
export type { ReviewPanelLocaleKey } from './locales.ts'
export { presentVerdict, type PresentedVerdict, type VerdictTone } from './present.ts'

/** Plugin name: matches the package name, the graph row id, and the bundle id. */
export const name = 'dsh-auto-review'

/** Services the panel reads; `remote.commands` is mounted by the api-remotes client. */
export const inject = ['slots', 'locale', 'remote', 'remote.commands']

/**
 * The structural shape of the api-remotes `commands` Remote namespace the
 * panel needs. Declared locally because the ambient namespace merge onto
 * `TypertClientRemote` is assembled from several generated modules and can
 * resolve to a different physical copy under strict package managers —
 * the runtime contract is what this client depends on, so the type is
 * pinned to it explicitly (rc.6 and rc.7 both serve this shape).
 */
interface CommandsRemote {
  readonly execute: (
    agentId: SessionId,
    line: string,
    signal?: AbortSignal,
  ) => Promise<
    | { ok: false; error: { code: string; message: string } }
    | { ok: true; value?: { result?: { kind?: string; text?: string } } }
  >
}

/**
 * Browser plugin body: dictionaries, the scoped stylesheet, and the
 * session-header action registration.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-auto-review: dictionaries')
  ctx.effect(() => installPanelStyles(), 'dsh-auto-review: stylesheet')
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'auto-review',
      order: 40,
      locale: NS,
      inject: (sessionId: SessionId): ReviewPanelInjected => {
        const remote = ctx.remote as unknown as { commands: CommandsRemote }
        const executeCommand = async (line: string): Promise<string> => {
          const result = await remote.commands.execute(sessionId, line)
          if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
          if (result.value === undefined) throw new Error('unknown command: /auto-review')
          const command = result.value.result
          if (command === undefined) throw new Error('/auto-review produced no command result')
          const text = command.text ?? ''
          return command.kind === 'success' ? text : `${command.kind}: ${text}`
        }
        return {
          approve: async (n: number): Promise<string> => executeCommand(`/auto-review approve ${n}`),
          setEnabled: async (enabled: boolean): Promise<string> => executeCommand(`/auto-review ${enabled ? 'on' : 'off'}`),
        }
      },
    }, ReviewPanel),
  )
}
