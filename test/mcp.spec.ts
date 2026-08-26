/**
 * stdio MCP server export tests: JSON-RPC protocol (initialize handshake,
 * tools/list schema, tools/call, error responses) and the deterministic
 * standalone review path (never-rule deny, unknown-tool fail-closed,
 * same-fingerprint cache replay, cache_stats).
 * @module dsh-auto-review/test/mcp.spec
 */

import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  StandaloneReviewer,
  createMcpServer,
} from '../src/mcp/index.ts'

/** A resolved config with one `never` rule and the default human policy. */
function configWithNeverRule() {
  return resolveConfig({
    riskRules: [{ pattern: 'rm -rf', policy: 'never', field: 'arguments' }],
    toolsPolicy: { default: 'human', overrides: {} },
  })
}

/** A reviewer + server pair over a resolved config. */
function makeServer() {
  const reviewer = new StandaloneReviewer(configWithNeverRule())
  return { reviewer, server: createMcpServer(reviewer, '0.6.0') }
}

describe('MCP protocol', () => {
  it('initialize handshake returns protocolVersion, tools capability and serverInfo', () => {
    const { server } = makeServer()
    const response = server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })!
    expect(response.jsonrpc).toBe('2.0')
    expect(response.id).toBe(1)
    expect(response.error).toBeUndefined()
    const result = response.result as Record<string, unknown>
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(result.capabilities).toEqual({ tools: {} })
    expect((result.serverInfo as Record<string, unknown>).name).toBe(MCP_SERVER_NAME)
    expect((result.serverInfo as Record<string, unknown>).version).toBe('0.6.0')
  })

  it('notifications/initialized is a no-op notification; ping returns an empty result', () => {
    const { server } = makeServer()
    expect(server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(server.handle({ jsonrpc: '2.0', id: 2, method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
  })

  it('tools/list exposes review_action and cache_stats schemas', () => {
    const { server } = makeServer()
    const result = server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' })!.result as { tools: Array<Record<string, unknown>> }
    const names = result.tools.map(tool => tool.name).sort()
    expect(names).toEqual(['cache_stats', 'review_action'])
    const reviewAction = result.tools.find(tool => tool.name === 'review_action')!
    expect(reviewAction.inputSchema).toMatchObject({ type: 'object', required: ['tool'] })
    const cacheStats = result.tools.find(tool => tool.name === 'cache_stats')!
    expect(cacheStats.inputSchema).toEqual({ type: 'object', properties: {} })
  })

  it('tools/call review_action returns a structured verdict', () => {
    const { server } = makeServer()
    const response = server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'review_action', arguments: { tool: 'bash', args: { command: 'rm -rf /' } } } })!
    expect(response.error).toBeUndefined()
    const result = response.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
    expect(result.isError).toBeUndefined()
    const verdict = JSON.parse(result.content[0]!.text) as Record<string, unknown>
    expect(verdict.decision).toBe('deny')
    expect(verdict.riskLevel).toBe('high')
    expect(String(verdict.reason)).toContain('risk rule /rm -rf/')
  })

  it('returns JSON-RPC error responses for unknown methods and invalid params', () => {
    const { server } = makeServer()
    expect((server.handle({ jsonrpc: '2.0', id: 5, method: 'nope' }) as { error: { code: number } }).error.code).toBe(-32601)
    expect((server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: {} }) as { error: { code: number } }).error.code).toBe(-32602)
    expect((server.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'review_action', arguments: {} } })!.result as { isError: boolean }).isError).toBe(true)
  })
})

describe('StandaloneReviewer', () => {
  it('deterministic never-rule path denies with the matched source', () => {
    const { reviewer } = makeServer()
    const verdict = reviewer.review({ tool: 'bash', args: { command: 'rm -rf /' } })
    expect(verdict.decision).toBe('deny')
    expect(verdict.riskLevel).toBe('high')
    expect(verdict.reason).toBe('hard-disabled by risk rule /rm -rf/ (arguments)')
    expect(verdict.cached).toBeUndefined()
  })

  it('unknown tool fails closed with "standalone path, no model"', () => {
    const { reviewer } = makeServer()
    const verdict = reviewer.review({ tool: 'read', args: { path: '/tmp/x' } })
    expect(verdict.decision).toBe('deny')
    expect(verdict.reason).toContain('standalone path, no model')
    // No risk rule matches and no model is available, so it must never allow.
    expect(verdict.decision).not.toBe('allow')
  })

  it('replays an identical fingerprint from the cache', () => {
    const { reviewer } = makeServer()
    const first = reviewer.review({ tool: 'read', args: { path: '/tmp/x' } })
    const second = reviewer.review({ tool: 'read', args: { path: '/tmp/x' } })
    expect(first.cached).toBeUndefined()
    expect(second.cached).toBe(true)
    expect(second).toEqual({ ...first, cached: true })
  })

  it('cache_stats reports hits, stores, size and TTL status', () => {
    const { reviewer } = makeServer()
    expect(reviewer.cacheStats()).toEqual({ hits: 0, stores: 0, size: 0, ttlMs: 60_000, enabled: true })
    reviewer.review({ tool: 'read', args: { path: '/tmp/x' } })
    reviewer.review({ tool: 'read', args: { path: '/tmp/x' } })
    expect(reviewer.cacheStats()).toMatchObject({ hits: 1, stores: 1, size: 1 })
  })
})
