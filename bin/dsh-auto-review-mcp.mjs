#!/usr/bin/env node
// dsh-auto-review stdio MCP server launcher. Serves review_action (deterministic
// verdict + same-fingerprint cache) and cache_stats over newline-delimited
// JSON-RPC 2.0 on stdio. No harness, no model, no write path — this is the
// independent, fail-closed review path; see README "MCP server (standalone)".
//
// Config comes from environment variables (see resolveEnvConfig):
//   DSH_AUTO_REVIEW_RISK_RULES            JSON [{pattern, policy, field?}]
//   DSH_AUTO_REVIEW_TOOLS_POLICY          JSON {default?, overrides?}
//   DSH_AUTO_REVIEW_CACHE_TTL_MS          non-negative integer
//   DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES     positive integer
import { readFileSync } from 'node:fs'
import { StandaloneReviewer, createMcpServer, resolveEnvConfig, runStdioServer } from '../lib/mcp.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const config = resolveEnvConfig(process.env)
const server = createMcpServer(new StandaloneReviewer(config), pkg.version)

runStdioServer(server)
