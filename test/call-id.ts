/**
 * Dual-ruler tool-call id brand for tests: derives the brand from
 * `dsh-tools`' `ToolExecution['callId']` instead of naming the host line's
 * brand (`CallId` on the published `0.1.1-rc.2` line, renamed `ToolCallId`
 * on host HEAD) — the same type either way, so both typecheck rulers stay
 * green.
 * @module dsh-auto-review/test/call-id
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

export type CallId = ToolExecution['callId']

/** Brand a synthetic call id; no validation is performed. */
export function CallId(id: string): CallId {
  return id as CallId
}
