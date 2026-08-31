/**
 * Dual-ruler call-id brand: host master renamed the dsh-llm `CallId`
 * brand to `ToolCallId`, while the published `0.1.1-rc.2` line still
 * exports `CallId`. Derive the brand from the dsh-tools execution
 * contract so this package typechecks on both rulers without naming
 * either brand name.
 * @module dsh-auto-review/call-id
 */

import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** One model-requested tool call, branded by the installed host line's own vocabulary. */
export type CallId = ToolExecution['callId']

/**
 * Brand a string as a {@link CallId}.
 * @param id - the raw call id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export const CallId = ((id: string) => id) as unknown as (id: string) => ToolExecution['callId']
