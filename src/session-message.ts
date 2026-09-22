/**
 * One `tool/result` event read in whichever shape the host wrote it.
 *
 * The `0.1.6-alpha.2` line (format V3) wrapped the model-facing result in a
 * single `tool-result` content block of a `role: 'user'` message. Host
 * `dsh-v0.1.7-alpha.1` (format V4) deleted that block type: the result is a
 * first-class `role: 'tool'` message carrying `toolCallId` and the result
 * blocks at the TOP level (`session-format-v3-to-v4/src/tool-role.ts`), and
 * the V4 admission path refuses any content that still contains a released
 * `tool-result` wrapper.
 *
 * READ side. The upgrade is one-way: this module never constructs the retired
 * V3 shape, and everything this plugin WRITES is V4 (`tool/result` events are
 * produced by the host, and `dsh-tools`/the agent loop own that write). What
 * it does do is READ both shapes, because:
 *
 * - `fixtures/sessions/*.json` are replayable logs authored on the V3 line and
 *   must keep proving the invariant companion (a fixture rewritten to V4 would
 *   stop testing the upgrade path a real user's log actually takes);
 * - a session log written by an older harness can still be replayed/restored
 *   under this host, and the reviewer's compact transcript must keep showing
 *   those results instead of silently dropping the evidence.
 *
 * @module dsh-auto-review/session-message
 */

/** One tool result normalized across the two durable shapes. */
export interface ToolResultView {
  /** The call id pairing `tool/call` and `tool/result` (top level in V4, wrapper field in V3). */
  readonly callId: string
  /** The raw result blocks, whichever field carried them. */
  readonly content: readonly { readonly type: string }[]
  /** Whether the invocation failed: the message's flag, else the wrapper's. */
  readonly isError: boolean | undefined
}

/** Narrow an unknown value to a non-null object for structural reads. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/** Read a non-empty string field, or undefined. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The content array of a message or wrapper, when it is an array. */
function asBlocks(value: unknown): readonly { readonly type: string }[] | undefined {
  return Array.isArray(value) ? value as readonly { readonly type: string }[] : undefined
}

/**
 * Normalize one `tool/result` event message into a {@link ToolResultView},
 * accepting the V4 first-class tool message and the retired V3 wrapper block.
 * @param message - the event's `message`, as stored (structurally, not typed).
 * @returns the normalized view, or undefined when the row carries no tool result.
 */
export function readToolResult(message: unknown): ToolResultView | undefined {
  const record = asRecord(message)
  if (record === undefined) return undefined
  const source = asRecord(record['source'])
  const sourceCallId = source === undefined ? undefined : asString(source['callId'])
  // V4: a first-class tool-role message. Its own content is the result.
  if (record['role'] === 'tool') {
    const callId = asString(record['toolCallId']) ?? sourceCallId
    const content = asBlocks(record['content'])
    if (callId === undefined || content === undefined) return undefined
    const isError = record['isError']
    return { callId, content, isError: typeof isError === 'boolean' ? isError : undefined }
  }
  // V3: exactly one `tool-result` wrapper block inside a user-role message.
  const wrapperBlock = asBlocks(record['content'])?.[0]
  const block = asRecord(wrapperBlock)
  if (block === undefined || block['type'] !== 'tool-result') return undefined
  const callId = asString(block['toolCallId']) ?? sourceCallId
  const content = asBlocks(block['content'])
  if (callId === undefined || content === undefined) return undefined
  const isError = block['isError']
  return { callId, content, isError: typeof isError === 'boolean' ? isError : undefined }
}

/**
 * Join the text blocks of a normalized tool result.
 * @param view - the normalized result.
 * @returns the concatenated text, '' when the result carried none.
 */
export function toolResultText(view: ToolResultView): string {
  return view.content
    .filter(block => block.type === 'text')
    .map(block => (block as unknown as { text: string }).text)
    .join('\n')
}

/**
 * Whether one `tool/result` event marks a failure, reading BOTH the event's
 * own `error` identity and the result message's `isError` flag.
 * @param error - the event's optional error identity.
 * @param view - the normalized result.
 * @returns true when either source says the invocation failed.
 */
export function toolResultIsError(error: unknown, view: ToolResultView): boolean {
  return error !== undefined || view.isError === true
}
