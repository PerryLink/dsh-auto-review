/**
 * Standalone deterministic review path for the stdio MCP server export.
 *
 * The in-process reviewer (`src/review.ts`) needs the harness subagent seam
 * and a second model, which a separate stdio process cannot reach. This module
 * is the independent verdict path: it reuses the same-fingerprint verdict
 * cache (`src/cache.ts`) and the risk-rule / tool-policy resolution
 * (`src/config.ts`), and settles deterministically:
 *
 * - a `never` risk rule or tool override → `deny` with the matched source;
 * - a cache hit on an identical `tool + arguments` fingerprint → replays that
 *   verdict (the only way an `allow` can surface in a standalone process);
 * - everything else (`ai` needs a model, `human` needs a human) → fail-closed
 *   `deny` with `reason: "standalone path, no model"`.
 *
 * The path is read-only and deterministic: no network, no model, no write.
 * @module dsh-auto-review/mcp/standalone
 */

import { fingerprint, VerdictCache } from '../cache.ts'
import { resolveConfig } from '../config.ts'
import type { Config, ResolvedConfig, RiskLevel, ToolReviewPolicy } from '../config.ts'

/** One standalone review request: the tool plus its (optional) arguments and reason. */
export interface StandaloneReviewInput {
  readonly tool: string
  readonly args?: unknown
  readonly reason?: string
}

/** The deterministic verdict a standalone review always returns (deny unless a cache hit replays). */
export interface StandaloneVerdict {
  readonly decision: 'allow' | 'deny'
  readonly reason: string
  readonly riskLevel: RiskLevel
  /** True when the verdict was replayed from the same-fingerprint cache. */
  readonly cached?: boolean
}

/** The cache_stats tool result: counters plus the TTL configuration. */
export interface CacheStats {
  readonly hits: number
  readonly stores: number
  readonly size: number
  readonly ttlMs: number
  readonly enabled: boolean
}

/** One policy resolution: the policy plus which rule or table entry produced it. */
interface ResolvedPolicy {
  readonly policy: ToolReviewPolicy
  readonly source: string
}

/**
 * Resolve the review policy for a standalone request. Mirrors the answerer's
 * `policyFor` (first matching risk rule, then the exact tool override, then
 * the table default) without needing an `ApprovalRequest` — the request
 * fields are passed directly.
 * @param config - the resolved config.
 * @param tool - the tool name.
 * @param reason - the calling agent's self-reported reason, when given.
 * @param argumentsText - the JSON text of the call arguments, when given.
 * @returns the policy and its provenance.
 */
function policyFor(
  config: ResolvedConfig,
  tool: string,
  reason: string | undefined,
  argumentsText: string | undefined,
): ResolvedPolicy {
  for (const rule of config.riskRules) {
    const subject = rule.field === 'reason'
      ? reason ?? ''
      : rule.field === 'toolName'
        ? tool
        : argumentsText ?? ''
    if (rule.regex.test(subject)) return { policy: rule.policy, source: `risk rule /${rule.pattern}/ (${rule.field})` }
  }
  const override = config.toolsPolicy.overrides[tool]
  if (override !== undefined) return { policy: override, source: `toolsPolicy.overrides.${tool}` }
  return { policy: config.toolsPolicy.default, source: 'toolsPolicy.default' }
}

/** Serialize an argument value for fingerprinting / rule matching; undefined on failure (circular). */
function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/**
 * The standalone reviewer: a TTL-bounded same-fingerprint cache plus the
 * deterministic policy resolution. Constructed once per process; `review`
 * is synchronous and side-effect free except for cache writes.
 */
export class StandaloneReviewer {
  private readonly cache: VerdictCache

  constructor(readonly config: ResolvedConfig) {
    this.cache = new VerdictCache({ ttlMs: config.verdictCacheTtlMs, maxEntries: config.verdictCacheMaxEntries })
  }

  /**
   * Deterministically review one action.
   * @param input - `{tool, args?, reason?}`.
   * @returns the verdict (fail-closed deny unless a rule or cache says otherwise).
   */
  review(input: StandaloneReviewInput): StandaloneVerdict {
    const now = Date.now()
    const rawArguments = input.args === undefined ? undefined : safeStringify(input.args)
    const fp = rawArguments === undefined ? undefined : fingerprint(input.tool, rawArguments)
    if (fp !== undefined) {
      const hit = this.cache.get(fp, now)
      if (hit !== undefined) {
        return {
          decision: hit.decision,
          reason: hit.reason,
          riskLevel: hit.riskLevel ?? 'medium',
          cached: true,
        }
      }
    }
    const { policy, source } = policyFor(this.config, input.tool, input.reason, rawArguments)
    let verdict: StandaloneVerdict
    if (policy === 'never') {
      verdict = { decision: 'deny', reason: `hard-disabled by ${source}`, riskLevel: 'high' }
    } else {
      // `ai` requires the second model, `human` requires a human answerer —
      // neither exists in a standalone process, so fail closed.
      verdict = { decision: 'deny', reason: 'standalone path, no model; fail-closed deny', riskLevel: 'medium' }
    }
    if (fp !== undefined) {
      this.cache.set(fp, { decision: verdict.decision, reason: verdict.reason, riskLevel: verdict.riskLevel }, now)
    }
    return verdict
  }

  /** Cache counters and TTL status for the `cache_stats` tool. */
  cacheStats(): CacheStats {
    return {
      hits: this.cache.hits,
      stores: this.cache.stores,
      size: this.cache.size,
      ttlMs: this.config.verdictCacheTtlMs,
      enabled: this.config.verdictCacheTtlMs > 0,
    }
  }
}

/** Parse a JSON env var into an unknown value, throwing a loud TypeError on bad JSON. */
function parseJsonEnv(name: string, raw: string | undefined): unknown | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch (error: unknown) {
    throw new TypeError(`${name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Parse a positive/zero integer env var, throwing a loud TypeError on bad input. */
function parseIntEnv(name: string, raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

/**
 * Build the resolved standalone config from environment variables, reusing
 * `resolveConfig` (so risk-rule regexes compile with the exact same flag
 * semantics and misconfiguration fails loud).
 *
 * - `DSH_AUTO_REVIEW_RISK_RULES` — JSON array of `{pattern, policy, field?}`.
 * - `DSH_AUTO_REVIEW_TOOLS_POLICY` — JSON `{default?, overrides?}`.
 * - `DSH_AUTO_REVIEW_CACHE_TTL_MS` / `DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES` — cache knobs.
 * @param env - process environment (test-injectable).
 * @returns the resolved config.
 */
export function resolveEnvConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const raw: Config = {}
  const riskRules = parseJsonEnv('DSH_AUTO_REVIEW_RISK_RULES', env.DSH_AUTO_REVIEW_RISK_RULES)
  if (riskRules !== undefined) raw.riskRules = riskRules as NonNullable<Config['riskRules']>
  const toolsPolicy = parseJsonEnv('DSH_AUTO_REVIEW_TOOLS_POLICY', env.DSH_AUTO_REVIEW_TOOLS_POLICY)
  if (toolsPolicy !== undefined) raw.toolsPolicy = toolsPolicy as NonNullable<Config['toolsPolicy']>
  const ttlMs = parseIntEnv('DSH_AUTO_REVIEW_CACHE_TTL_MS', env.DSH_AUTO_REVIEW_CACHE_TTL_MS)
  if (ttlMs !== undefined) raw.verdictCacheTtlMs = ttlMs
  const maxEntries = parseIntEnv('DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES', env.DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES)
  if (maxEntries !== undefined) raw.verdictCacheMaxEntries = maxEntries
  return resolveConfig(raw)
}
