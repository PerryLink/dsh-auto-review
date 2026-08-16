/**
 * Trace collection for dsh-eval: fold one agent session's durable event log
 * (from an anchor sequence) into an owned, JSON-serializable case trace —
 * tool-call/result pairs, the final assistant text, summed token usage, the
 * final turn outcome, and the last request header (system prompt + tool
 * catalog). Pure functions over `readonly SessionEvent[]`; no live DSH
 * references survive into the returned values.
 * @module dsh-auto-review/eval/trace
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

/** One collected tool invocation: the call and, when present, its paired result. */
export interface ToolCallRecord {
  /** The call id pairing `tool/call` and `tool/result`. */
  readonly callId: string
  /** The requested tool name. */
  readonly name: string
  /** The raw arguments JSON exactly as the model produced it. */
  readonly arguments: string
  /** The parsed arguments, when they are valid JSON. */
  readonly argumentsJson?: unknown
  /** The paired result, when the log has it. */
  readonly result?: {
    /** The concatenated text of the result message's content blocks. */
    readonly text: string
    /** Whether the result carries an error identity. */
    readonly isError: boolean
    /** The structured error identity, when the log recorded one. */
    readonly error?: { name: string; code: string }
  }
}

/** Summed token accounting across the traced interval. */
export interface TraceTokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly reasoningTokens: number
}

/** Owned copy of one turn-end reason (unknown kinds degrade to a label). */
export type TraceTurnEnd =
  | { kind: 'completed' }
  | { kind: 'aborted' }
  | { kind: 'blocked' }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'max-tokens' }
  | { kind: 'interrupted' }
  | { kind: 'unknown' }

/** One collected request header: the model-visible prompt and tool catalog. */
export interface TraceRequestHeader {
  /** The rendered system prompt text, when the request had one. */
  readonly system?: string
  /** The assembled tool schemas (the request-time tool catalog). */
  readonly tools: readonly TraceToolSchema[]
  /** The provider/model route the request used. */
  readonly provider?: string
  readonly model?: string
  readonly contextWindow?: number
}

/** Owned copy of one tool schema entry (name + description). */
export interface TraceToolSchema {
  readonly name: string
  readonly description?: string
}

/** The complete collected trace of one case run. */
export interface CaseTrace {
  /** The agent/session id the run executed in. */
  readonly sessionId: string
  /** The first event sequence number included (the anchor). */
  readonly firstSeq: number
  /** The last event sequence number included. */
  readonly lastSeq: number
  /** Tool calls in log order. */
  readonly toolCalls: readonly ToolCallRecord[]
  /** The last non-empty assistant text, or '' when the run produced none. */
  readonly finalOutput: string
  /** Summed token usage; absent when the adapter reported none. */
  readonly tokenUsage?: TraceTokenUsage
  /** The final turn-end reason of the traced interval. */
  readonly turnEnd?: TraceTurnEnd
  /** The last request header of the traced interval. */
  readonly requestHeader?: TraceRequestHeader
}

/** Extract the text blocks of a message's content as one string. */
function contentText(content: readonly { type: string }[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => (block as unknown as { text: string }).text)
    .join('')
}

/** Parse JSON without throwing. */
function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** Copy one turn-end reason into the owned {@link TraceTurnEnd} shape. */
function copyTurnEnd(value: unknown): TraceTurnEnd {
  if (typeof value !== 'object' || value === null) return { kind: 'unknown' }
  const record = value as Record<string, unknown>
  const kind = record.kind
  switch (kind) {
    case 'completed': return { kind: 'completed' }
    case 'blocked': return { kind: 'blocked' }
    case 'max-tokens': return { kind: 'max-tokens' }
    case 'interrupted': return { kind: 'interrupted' }
    case 'aborted': return { kind: 'aborted' }
    case 'error': {
      const error = record.error
      if (typeof error === 'object' && error !== null) {
        const fact = error as Record<string, unknown>
        return {
          kind: 'error',
          code: typeof fact.code === 'string' ? fact.code : 'UNKNOWN',
          message: typeof fact.message === 'string' ? fact.message : String(fact),
        }
      }
      return { kind: 'error', code: 'UNKNOWN', message: String(error) }
    }
    default: return { kind: 'unknown' }
  }
}

/**
 * Fold the session events at or after `firstSeq` into a {@link CaseTrace}.
 * Events before the anchor (startup/seed) are excluded; the anchor is what
 * makes one case's trace independent of the agent's creation noise.
 * @param sessionId - the session the events belong to.
 * @param events - the session's event log in order.
 * @param firstSeq - the anchor sequence (inclusive).
 * @returns the owned trace.
 */
export function collectTrace(sessionId: SessionId, events: readonly SessionEvent[], firstSeq: number): CaseTrace {
  const toolCalls: ToolCallRecord[] = []
  const resultsByCall = new Map<string, { text: string; isError: boolean; error?: { name: string; code: string } }>()
  let finalOutput = ''
  let usage: TraceTokenUsage | undefined
  let turnEnd: TraceTurnEnd | undefined
  let requestHeader: TraceRequestHeader | undefined
  let lastSeq = firstSeq - 1
  for (const event of events) {
    if (event.seq < firstSeq) continue
    lastSeq = event.seq
    switch (event.type) {
      case 'tool/call': {
        toolCalls.push({
          callId: event.data.callId,
          name: event.data.name,
          arguments: event.data.arguments,
          ...((): { argumentsJson?: unknown } => {
            const parsed = tryParseJson(event.data.arguments)
            return parsed === undefined ? {} : { argumentsJson: parsed }
          })(),
        })
        break
      }
      case 'tool/result': {
        const block = event.data.message.content[0]
        if (block === undefined || block.type !== 'tool-result') break
        const text = contentText(block.content as readonly { type: string }[])
        const isError = event.data.error !== undefined || block.isError === true
        resultsByCall.set(block.toolCallId, {
          text,
          isError,
          ...(event.data.error !== undefined ? { error: { name: event.data.error.name, code: event.data.error.code } } : {}),
        })
        break
      }
      case 'assistant/message': {
        const joined = contentText(event.data.message.content as readonly { type: string }[])
        if (joined !== '') finalOutput = joined
        if (event.data.usage !== undefined) {
          const acc = usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
          usage = {
            inputTokens: acc.inputTokens + event.data.usage.inputTokens,
            outputTokens: acc.outputTokens + event.data.usage.outputTokens,
            cacheReadTokens: acc.cacheReadTokens + (event.data.usage.cacheReadTokens ?? 0),
            cacheWriteTokens: acc.cacheWriteTokens + (event.data.usage.cacheWriteTokens ?? 0),
            reasoningTokens: acc.reasoningTokens + (event.data.usage.reasoningTokens ?? 0),
          }
        }
        break
      }
      case 'turn/end': {
        turnEnd = copyTurnEnd(event.data.reason)
        break
      }
      case 'request/header': {
        const header = event.data.header
        requestHeader = {
          ...(header.system !== undefined ? { system: header.system } : {}),
          tools: (header.tools ?? []).map(tool => {
            const schema = tool as { name?: string; description?: string }
            return {
              ...(schema.name !== undefined ? { name: schema.name } : { name: '(unnamed)' }),
              ...(schema.description !== undefined ? { description: schema.description } : {}),
            }
          }),
        }
        break
      }
      case 'request/context': {
        requestHeader = {
          ...(requestHeader ?? { tools: [] }),
          provider: event.data.provider,
          model: event.data.model,
          ...(event.data.contextWindow !== undefined ? { contextWindow: event.data.contextWindow } : {}),
        }
        break
      }
      default: break
    }
  }
  for (const call of toolCalls) {
    const result = resultsByCall.get(call.callId)
    if (result !== undefined) (call as { result?: ToolCallRecord['result'] }).result = result
  }
  return {
    sessionId: sessionId as string,
    firstSeq,
    lastSeq,
    toolCalls,
    finalOutput,
    ...(usage !== undefined ? { tokenUsage: usage } : {}),
    ...(turnEnd !== undefined ? { turnEnd } : {}),
    ...(requestHeader !== undefined ? { requestHeader } : {}),
  }
}

/** Render one tool call as a compact single line (reports, review prompts). */
export function renderToolCall(call: ToolCallRecord): string {
  const result = call.result === undefined
    ? '(no result recorded)'
    : `${call.result.isError ? 'error' : 'ok'}: ${call.result.text.slice(0, 300)}`
  return `${call.name} ${call.arguments.slice(0, 300)} → ${result}`
}
