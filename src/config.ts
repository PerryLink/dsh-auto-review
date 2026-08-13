/**
 * Config schema and resolution for `dsh-auto-review`. Every tunable is a
 * validated {@link Config} field changeable from cordis.yml; the resolution
 * step compiles risk-rule regexes and fails loud on invalid input.
 * @module dsh-auto-review/config
 */

import z from '@deepseek-ai/schemastery'

/**
 * What one approval request does at the auto-review answerer:
 *
 * - `'ai'` — the AI reviewer decides (allow/deny) and the request never
 *   reaches a human answerer.
 * - `'human'` — the request is delegated (`next()`) to the human answerer;
 *   auto-review does not short-circuit the chain.
 * - `'never'` — the answerer rejects deterministically. Only for tools an
 *   admin wants hard-disabled whenever approval is required.
 */
export type ToolReviewPolicy = 'ai' | 'human' | 'never'

/** Risk levels the reviewer may attach to a verdict. */
export type RiskLevel = 'low' | 'medium' | 'high'

/**
 * What happens when the reviewer cannot deliver a verdict (crash, timeout,
 * subagent unavailable, schema mismatch):
 *
 * - `'rejected'` — fail closed; the request is denied (the default).
 * - `'delegate'` — the request is passed down the answerer chain (a human
 *   answerer, when one is composed).
 * - `'allow-readonly'` — the request is granted. Deliberately dangerous: the
 *   grant is unconditional, not "readonly" in any enforced sense; it exists
 *   for unattended deployments whose admin accepts that risk.
 */
export type FallbackPolicy = 'rejected' | 'delegate' | 'allow-readonly'

/** One risk rule: a regex matched against the request reason, first match wins. */
export interface RiskRuleConfig {
  /** Regular expression source (compiled without flags). */
  pattern: string
  /** The policy a matching request resolves to. */
  policy: ToolReviewPolicy
}

/** Per-tool policy table: explicit overrides, then a default for unlisted tools. */
export interface ToolsPolicyConfig {
  /** Policy for tools not named in {@link overrides}. Default `'human'` (delegate). */
  default: ToolReviewPolicy
  /** Exact tool-name → policy mapping. */
  overrides: Record<string, ToolReviewPolicy>
}

/** Raw plugin config — every field optional; {@link Config} supplies the defaults. */
export interface Config {
  /**
   * Whether sessions start with auto-review enabled. The `/auto-review`
   * command writes a durable per-session override that beats this default.
   */
  enableByDefault?: boolean
  /** Tool policy table (defaults + per-tool overrides). */
  toolsPolicy?: Partial<ToolsPolicyConfig>
  /** Risk rules matched (first match wins) against the request reason before the tool table. */
  riskRules?: RiskRuleConfig[]
  /** Subagent provider name for the reviewer (default `fork`, the in-process fork backend). */
  reviewerProvider?: string
  /** Reviewer model id; when unset the reviewer inherits the session agent's route. */
  reviewerModel?: string
  /** Verdict deadline in milliseconds. Default 60000. */
  reviewerTimeoutMs?: number
  /**
   * The reviewer's tool allow-list — read-only tools by default. The subagent
   * `toolFilter` is an allow-list: anything not named here is invisible to
   * and unexecutable by the reviewer child.
   */
  reviewerTools?: string[]
  /** Reviewer failure policy (see {@link FallbackPolicy}). Default `'rejected'`. */
  fallbackPolicy?: FallbackPolicy
  /** Maximum AI verdicts per open turn; further requests delegate to humans. */
  maxReviewsPerTurn?: number
  /** Cap applied to reviewer reasons (and the redacted argument preview) before they enter prompts or logs. */
  reasonMaxChars?: number
  /** Optional extra guidance appended to the reviewer prompt (advisory, not a hard rule). */
  reviewerGuidance?: string
}

/** Config after {@link resolveConfig}: every optional field has its explicit default. */
export interface ResolvedConfig {
  readonly enableByDefault: boolean
  readonly toolsPolicy: ToolsPolicyConfig
  readonly riskRules: readonly ResolvedRiskRule[]
  readonly reviewerProvider: string
  readonly reviewerModel: string | undefined
  readonly reviewerTimeoutMs: number
  readonly reviewerTools: readonly string[]
  readonly fallbackPolicy: FallbackPolicy
  readonly maxReviewsPerTurn: number
  readonly reasonMaxChars: number
  readonly reviewerGuidance: string | undefined
}

/** A compiled {@link RiskRuleConfig}, ready to test against a request reason. */
export interface ResolvedRiskRule {
  /** The original pattern source, kept for prompts and audit. */
  readonly pattern: string
  readonly regex: RegExp
  readonly policy: ToolReviewPolicy
}

const POLICY = z.union(['ai', 'human', 'never'] as const)
const FALLBACK = z.union(['rejected', 'delegate', 'allow-readonly'] as const)

/** Schemastery schema: the loader validates and fills defaults before `apply`. */
export const Config: z<Config> = z.object({
  enableByDefault: z.boolean().default(true),
  toolsPolicy: z.object({
    default: POLICY.default('human'),
    overrides: z.dict(POLICY).default({}),
  }).default({ default: 'human', overrides: {} }),
  riskRules: z.array(z.object({
    pattern: z.string(),
    policy: POLICY,
  })).default([]),
  reviewerProvider: z.string().default('fork'),
  reviewerModel: z.string(),
  reviewerTimeoutMs: z.number().default(60_000),
  reviewerTools: z.array(z.string()).default(['read', 'glob', 'grep']),
  fallbackPolicy: FALLBACK.default('rejected'),
  maxReviewsPerTurn: z.number().default(10),
  reasonMaxChars: z.number().default(2000),
  reviewerGuidance: z.string(),
})

/**
 * Validate raw values and compile the resolved config. Defaults are applied
 * HERE — the explicit resolution step — so a partially-specified config from
 * a direct `ctx.plugin` mount behaves like the loader-filled one.
 * @param config - raw (possibly partial) plugin config.
 * @returns the fully resolved config.
 * @throws TypeError on invalid risk-rule regexes, non-positive budgets, or
 *   out-of-range numbers (misconfiguration fails loud).
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  if (!Number.isSafeInteger(config.reviewerTimeoutMs ?? 60_000) || (config.reviewerTimeoutMs ?? 60_000) <= 0) {
    throw new TypeError(`reviewerTimeoutMs must be a positive safe integer, got ${String(config.reviewerTimeoutMs)}`)
  }
  if (!Number.isSafeInteger(config.maxReviewsPerTurn ?? 10) || (config.maxReviewsPerTurn ?? 10) <= 0) {
    throw new TypeError(`maxReviewsPerTurn must be a positive safe integer, got ${String(config.maxReviewsPerTurn)}`)
  }
  if (!Number.isSafeInteger(config.reasonMaxChars ?? 2000) || (config.reasonMaxChars ?? 2000) <= 0) {
    throw new TypeError(`reasonMaxChars must be a positive safe integer, got ${String(config.reasonMaxChars)}`)
  }
  const riskRules = (config.riskRules ?? []).map((rule): ResolvedRiskRule => {
    let regex: RegExp
    try {
      // Flags are stripped: a global flag would make repeated .test() calls
      // stateful (lastIndex), and other flags would silently change semantics.
      regex = new RegExp(rule.pattern, 'u')
    } catch (error: unknown) {
      throw new TypeError(`risk rule pattern ${JSON.stringify(rule.pattern)} is not a valid regular expression: ${String(error)}`)
    }
    return { pattern: rule.pattern, regex, policy: rule.policy }
  })
  return {
    enableByDefault: config.enableByDefault ?? true,
    toolsPolicy: {
      default: config.toolsPolicy?.default ?? 'human',
      overrides: config.toolsPolicy?.overrides ?? {},
    },
    riskRules,
    reviewerProvider: config.reviewerProvider ?? 'fork',
    reviewerModel: config.reviewerModel,
    reviewerTimeoutMs: config.reviewerTimeoutMs ?? 60_000,
    reviewerTools: config.reviewerTools ?? ['read', 'glob', 'grep'],
    fallbackPolicy: config.fallbackPolicy ?? 'rejected',
    maxReviewsPerTurn: config.maxReviewsPerTurn ?? 10,
    reasonMaxChars: config.reasonMaxChars ?? 2000,
    reviewerGuidance: config.reviewerGuidance,
  }
}
