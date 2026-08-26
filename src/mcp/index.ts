/**
 * The stdio MCP server export entry: the deterministic standalone reviewer
 * plus the JSON-RPC transport. Bundled to `lib/mcp.js`; launched by
 * `bin/dsh-auto-review-mcp.mjs`.
 * @module dsh-auto-review/mcp
 */

export {
  StandaloneReviewer,
  resolveEnvConfig,
} from './standalone.ts'
export type {
  StandaloneReviewInput,
  StandaloneVerdict,
  CacheStats,
} from './standalone.ts'
export {
  createMcpServer,
  runStdioServer,
  MCP_SERVER_NAME,
  MCP_PROTOCOL_VERSION,
} from './server.ts'
export type { McpServer } from './server.ts'
