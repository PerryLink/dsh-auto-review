/**
 * JSON-RPC 2.0 / MCP transport for the standalone review server: a stdio
 * loop speaking newline-delimited JSON (NDJSON). Exposes two tools —
 * `review_action` (deterministic verdict) and `cache_stats` (cache counters).
 * No Content-Length framing is supported; the wire format is one JSON object
 * per line. This module owns only the protocol dispatch — every decision
 * lives in {@link StandaloneReviewer}.
 * @module dsh-auto-review/mcp/server
 */

import { createInterface } from 'node:readline'
import type { StandaloneReviewer } from './standalone.ts'

/** MCP server name (initialize's `serverInfo.name`). */
export const MCP_SERVER_NAME = 'dsh-auto-review'

/** The MCP protocol version this export speaks. */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** `review_action` tool definition. */
const REVIEW_ACTION_TOOL = {
  name: 'review_action',
  description: 'Deterministically review a pending tool action: deny on a matched never-rule or fail-closed (standalone path, no model), or replay a cached verdict for an identical tool+arguments fingerprint.',
  inputSchema: {
    type: 'object',
    properties: {
      tool: { type: 'string', description: 'The tool name of the pending action.' },
      args: { type: 'object', description: 'The call arguments (optional; used for risk-rule and fingerprint matching).' },
      reason: { type: 'string', description: 'The calling agent self-reported reason (optional; matched by reason-field risk rules).' },
    },
    required: ['tool'],
  },
}

/** `cache_stats` tool definition. */
const CACHE_STATS_TOOL = {
  name: 'cache_stats',
  description: 'Return the same-fingerprint verdict cache counters (hits, stores, live size) and its TTL status.',
  inputSchema: { type: 'object', properties: {} },
}

/** The MCP server surface: a JSON-RPC dispatcher plus its tool list. */
export interface McpServer {
  /** Dispatch one parsed JSON-RPC message; returns a response object or null for notifications. */
  readonly handle: (message: unknown) => Record<string, unknown> | null
  readonly tools: ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown> }>
}

/** Build a JSON-RPC error response (id null when the request had none). */
function errorResponse(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/**
 * Assemble the MCP server around a reviewer.
 * @param reviewer - the deterministic standalone reviewer.
 * @param version - the package version reported in `initialize`.
 * @returns the dispatcher and tool list.
 */
export function createMcpServer(reviewer: StandaloneReviewer, version: string): McpServer {
  const tools = [REVIEW_ACTION_TOOL, CACHE_STATS_TOOL] as const

  /** Call one tool; returns the MCP `tools/call` result shape (content blocks). */
  function callTool(name: string, args: unknown): { content: unknown[]; isError?: boolean } {
    switch (name) {
      case 'review_action': {
        const input = (args ?? {}) as Record<string, unknown>
        if (typeof input.tool !== 'string' || input.tool.length === 0) {
          return { content: [{ type: 'text', text: 'invalid arguments: tool must be a non-empty string' }], isError: true }
        }
        const verdict = reviewer.review({
          tool: input.tool,
          args: input.args,
          ...(typeof input.reason === 'string' ? { reason: input.reason } : {}),
        })
        return { content: [{ type: 'text', text: JSON.stringify(verdict, null, 2) }] }
      }
      case 'cache_stats': {
        return { content: [{ type: 'text', text: JSON.stringify(reviewer.cacheStats(), null, 2) }] }
      }
      default:
        return { content: [{ type: 'text', text: `unknown tool: ${name}` }], isError: true }
    }
  }

  /**
   * JSON-RPC 2.0 dispatch. Notifications (no `id`) produce no response.
   * @param message - a parsed JSON-RPC message.
   * @returns the response object to write back, or null for notifications.
   */
  function handle(message: unknown): Record<string, unknown> | null {
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      return errorResponse(null, -32600, 'Invalid Request')
    }
    const record = message as Record<string, unknown>
    const hasId = Object.prototype.hasOwnProperty.call(record, 'id')
    const id = hasId ? record.id : undefined
    const method = record.method
    if (typeof method !== 'string') {
      return hasId ? errorResponse(id, -32600, 'Invalid Request') : null
    }
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: MCP_SERVER_NAME, version },
          },
        }
      case 'notifications/initialized':
        return hasId ? { jsonrpc: '2.0', id, result: {} } : null
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools } }
      case 'tools/call': {
        const params = (record.params ?? {}) as Record<string, unknown>
        if (typeof params.name !== 'string') {
          return errorResponse(id, -32602, 'invalid params: tools/call requires a string "name"')
        }
        return { jsonrpc: '2.0', id, result: callTool(params.name, params.arguments) }
      }
      default:
        return hasId ? errorResponse(id, -32601, `Method not found: ${method}`) : null
    }
  }

  return { handle, tools }
}

/**
 * Run the NDJSON transport on stdio: one JSON object per line in, one response
 * per request out. Notifications and blank lines are skipped; unparseable
 * input produces a `-32700` parse-error response.
 * @param server - the dispatcher from {@link createMcpServer}.
 * @param io - injectable stdin/stdout for tests; defaults to the real process.
 * @returns a disposer that closes the readline interface.
 */
export function runStdioServer(
  server: McpServer,
  io: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WritableStream } = {},
): () => void {
  const input = io.stdin ?? process.stdin
  const output = io.stdout ?? process.stdout
  const reader = createInterface({ input, crlfDelay: Infinity })
  reader.on('line', (line: string) => {
    const trimmed = line.trim()
    if (trimmed === '') return
    let message: unknown
    try {
      message = JSON.parse(trimmed) as unknown
    } catch {
      output.write(`${JSON.stringify(errorResponse(null, -32700, 'Parse error'))}\n`)
      return
    }
    const response = server.handle(message)
    if (response !== null && response !== undefined) {
      output.write(`${JSON.stringify(response)}\n`)
    }
  })
  return () => reader.close()
}
