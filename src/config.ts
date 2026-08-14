/**
 * Config schema and resolution for `dsh-auto-review`. Every tunable is a
 * validated {@link Config} field changeable from cordis.yml; the resolution
 * step compiles risk-rule regexes and fails loud on invalid input.
 * @module dsh-auto-review/config
 */

import z from '@deepseek-ai/schemastery'
import type { UiLanguage } from './messages.ts'

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

/** The risk-level ordering, low first — the comparison base of {@link RiskPolicyConfig}. */
export const RISK_ORDER: readonly RiskLevel[] = ['low', 'medium', 'high']

/** What a risk-rule pattern is matched against. */
export type RiskRuleField = 'reason' | 'toolName' | 'arguments'

/**
 * What happens when the reviewer cannot deliver a verdict (crash, timeout,
 * subagent unavailable, schema mismatch):
 *
 * - `'rejected'` — fail closed; the request is denied (the default).
 * - `'delegate'` — the request is passed down the answerer chain (a human
 *   answerer, when one is composed).
 * - `'allow-once'` — the request is granted once. Deliberately dangerous:
 *   the grant is unconditional, not "readonly" in any enforced sense; it
 *   exists for unattended deployments whose admin accepts that risk. Renamed
 *   from `allow-readonly` in 0.2.0 for honesty; the old spelling is rejected
 *   loudly.
 */
export type FallbackPolicy = 'rejected' | 'delegate' | 'allow-once'

/**
 * How much of the session transcript the reviewer receives as compact
 * context (the calling session's recent user/assistant messages and tool
 * results, redacted and truncated). `turns: 0` disables the section.
 */
export interface ContextBudgetConfig {
  /** How many completed turns (plus the current one) of transcript to include; 0 disables. */
  readonly turns: number
  /** Character cap applied to the whole context section. */
  readonly maxChars: number
}

/** What a tripped rejection circuit breaker does to later ai-policy requests in the turn. */
export type CircuitAction = 'delegate' | 'reject' | 'abort-turn'

/**
 * The rejection circuit breaker: after a run of denials the turn stops
 * asking the reviewer. Trips on {@link consecutiveDenies} consecutive deny
 * verdicts in the turn OR {@link windowDenies} denials inside the last
 * {@link windowSize} verdicts of the turn, whichever comes first.
 */
export interface CircuitBreakerConfig {
  /** Consecutive deny verdicts in one turn that trip the breaker. */
  readonly consecutiveDenies: number
  /** Deny count inside the window that trips the breaker. */
  readonly windowDenies: number
  /** How many recent verdicts the window counts. */
  readonly windowSize: number
  /** What later requests in the turn do once tripped. */
  readonly action: CircuitAction
}

/**
 * How the reviewer's verdict risk level constrains the outcome: an `allow`
 * verdict whose risk exceeds {@link maxAutoAllow} never settles the request
 * — it delegates to the human chain (or denies) per {@link onHighRisk}.
 */
export interface RiskPolicyConfig {
  /** The highest risk level an allow verdict may settle with. */
  readonly maxAutoAllow: RiskLevel
  /** What happens to an allow verdict above the cap. */
  readonly onHighRisk: 'delegate' | 'deny'
}

/** One risk rule: a regex matched against the request reason, tool name, or redacted call arguments. */
export interface RiskRuleConfig {
  /** Regular expression source (compiled without flags). */
  pattern: string
  /** The policy a matching request resolves to. */
  policy: ToolReviewPolicy
  /** What the pattern is matched against. Default `'reason'`; `'arguments'` matches the redacted presented call arguments. */
  field?: RiskRuleField
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
   * and unexecutable by the reviewer child. Must be non-empty.
   */
  reviewerTools?: string[]
  /** Reviewer failure policy (see {@link FallbackPolicy}). Default `'rejected'`. */
  fallbackPolicy?: FallbackPolicy
  /** Maximum real AI verdicts per open turn; further requests delegate to humans. */
  maxReviewsPerTurn?: number
  /**
   * Maximum reviewer failures (timeout/unavailable/schema — not user
   * cancellations) per open turn; beyond it, further requests delegate
   * instead of paying another full timeout. Defaults to
   * {@link maxReviewsPerTurn}.
   */
  maxFailuresPerTurn?: number
  /** Cap applied to reviewer reasons, the request reason, and the redacted argument preview before they enter prompts or logs. */
  reasonMaxChars?: number
  /** Optional extra guidance appended to the reviewer prompt (advisory, not a hard rule). */
  reviewerGuidance?: string
  /**
   * Optional policy text injected into the reviewer prompt as the ruling
   * policy (Markdown: always-deny / always-allow / require-justification
   * sections), like Codex `auto_review.policy`. A template ships at
   * `fixtures/config/policy-template.md`.
   */
  reviewerPolicyText?: string
  /** Guidance appended to every injected deny reason (anti-circumvention). */
  denyGuidance?: string
  /** Compact transcript budget for the reviewer prompt (see {@link ContextBudgetConfig}). */
  contextBudget?: Partial<ContextBudgetConfig>
  /** Verdict risk-level constraints (see {@link RiskPolicyConfig}). */
  riskPolicy?: Partial<RiskPolicyConfig>
  /** The rejection circuit breaker (see {@link CircuitBreakerConfig}). */
  circuitBreaker?: Partial<CircuitBreakerConfig>
  /** How long a `/auto-review approve` override stays usable, in milliseconds. Default 5 minutes. */
  overrideTtlMs?: number
  /** UI language of the `/auto-review` command output (`en` | `zh`). Default `'en'`. */
  language?: UiLanguage
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
  readonly maxFailuresPerTurn: number
  readonly reasonMaxChars: number
  readonly reviewerGuidance: string | undefined
  readonly reviewerPolicyText: string | undefined
  readonly denyGuidance: string
  readonly contextBudget: ContextBudgetConfig
  readonly riskPolicy: RiskPolicyConfig
  readonly circuitBreaker: CircuitBreakerConfig
  readonly overrideTtlMs: number
  readonly language: UiLanguage
}

/** A compiled {@link RiskRuleConfig}, ready to test against its configured field. */
export interface ResolvedRiskRule {
  /** The original pattern source, kept for prompts and audit. */
  readonly pattern: string
  readonly regex: RegExp
  readonly policy: ToolReviewPolicy
  readonly field: RiskRuleField
}

const POLICY = z.union(['ai', 'human', 'never'] as const)
const FALLBACK = z.union(['rejected', 'delegate', 'allow-once'] as const)
const RISK = z.union(['low', 'medium', 'high'] as const)
const FIELD = z.union(['reason', 'toolName', 'arguments'] as const)
const CIRCUIT_ACTION = z.union(['delegate', 'reject', 'abort-turn'] as const)

/** Default anti-circumvention guidance appended to every injected deny reason. */
export const DEFAULT_DENY_GUIDANCE = 'Do not attempt to work around this denial. '
  + 'Choose a materially safer alternative that stays inside your permissions, or ask the user before retrying this action.'

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
    field: FIELD.default('reason'),
  })).default([]),
  reviewerProvider: z.string().default('fork'),
  reviewerModel: z.string(),
  reviewerTimeoutMs: z.number().default(60_000),
  reviewerTools: z.array(z.string()).default(['read', 'glob', 'grep']),
  fallbackPolicy: FALLBACK.default('rejected'),
  maxReviewsPerTurn: z.number().default(10),
  maxFailuresPerTurn: z.number(),
  reasonMaxChars: z.number().default(2000),
  reviewerGuidance: z.string(),
  reviewerPolicyText: z.string(),
  denyGuidance: z.string().default(DEFAULT_DENY_GUIDANCE),
  contextBudget: z.object({
    turns: z.number().default(0),
    maxChars: z.number().default(4000),
  }).default({ turns: 0, maxChars: 4000 }),
  riskPolicy: z.object({
    maxAutoAllow: RISK.default('high'),
    onHighRisk: z.union(['delegate', 'deny'] as const).default('delegate'),
  }).default({ maxAutoAllow: 'high', onHighRisk: 'delegate' }),
  circuitBreaker: z.object({
    consecutiveDenies: z.number().default(3),
    windowDenies: z.number().default(10),
    windowSize: z.number().default(50),
    action: CIRCUIT_ACTION.default('delegate'),
  }).default({ consecutiveDenies: 3, windowDenies: 10, windowSize: 50, action: 'delegate' }),
  overrideTtlMs: z.number().default(5 * 60_000),
  language: z.union(['en', 'zh'] as const).default('en'),
})

/** Whether `level` ranks strictly above `cap` in {@link RISK_ORDER}. */
export function riskExceeds(level: RiskLevel, cap: RiskLevel): boolean {
  return RISK_ORDER.indexOf(level) > RISK_ORDER.indexOf(cap)
}

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
  if (!Number.isSafeInteger(config.maxFailuresPerTurn ?? 10) || (config.maxFailuresPerTurn ?? 10) <= 0) {
    throw new TypeError(`maxFailuresPerTurn must be a positive safe integer, got ${String(config.maxFailuresPerTurn)}`)
  }
  if (!Number.isSafeInteger(config.reasonMaxChars ?? 2000) || (config.reasonMaxChars ?? 2000) <= 0) {
    throw new TypeError(`reasonMaxChars must be a positive safe integer, got ${String(config.reasonMaxChars)}`)
  }
  const turns = config.contextBudget?.turns ?? 0
  if (!Number.isSafeInteger(turns) || turns < 0) {
    throw new TypeError(`contextBudget.turns must be a non-negative safe integer, got ${String(turns)}`)
  }
  const contextChars = config.contextBudget?.maxChars ?? 4000
  if (!Number.isSafeInteger(contextChars) || contextChars <= 0) {
    throw new TypeError(`contextBudget.maxChars must be a positive safe integer, got ${String(contextChars)}`)
  }
  const breaker = config.circuitBreaker ?? {}
  for (const [key, value] of [['consecutiveDenies', breaker.consecutiveDenies ?? 3], ['windowDenies', breaker.windowDenies ?? 10], ['windowSize', breaker.windowSize ?? 50]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`circuitBreaker.${key} must be a positive safe integer, got ${String(value)}`)
    }
  }
  if (!Number.isSafeInteger(config.overrideTtlMs ?? 5 * 60_000) || (config.overrideTtlMs ?? 5 * 60_000) <= 0) {
    throw new TypeError(`overrideTtlMs must be a positive safe integer, got ${String(config.overrideTtlMs)}`)
  }
  const reviewerTools = config.reviewerTools ?? ['read', 'glob', 'grep']
  if (reviewerTools.length === 0) {
    throw new TypeError('reviewerTools must name at least one tool: an empty allow-list would leave the reviewer with no tool face')
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
    return { pattern: rule.pattern, regex, policy: rule.policy, field: rule.field ?? 'reason' }
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
    reviewerTools,
    fallbackPolicy: config.fallbackPolicy ?? 'rejected',
    maxReviewsPerTurn: config.maxReviewsPerTurn ?? 10,
    maxFailuresPerTurn: config.maxFailuresPerTurn ?? config.maxReviewsPerTurn ?? 10,
    reasonMaxChars: config.reasonMaxChars ?? 2000,
    reviewerGuidance: config.reviewerGuidance,
    reviewerPolicyText: config.reviewerPolicyText,
    denyGuidance: config.denyGuidance ?? DEFAULT_DENY_GUIDANCE,
    contextBudget: { turns, maxChars: contextChars },
    riskPolicy: {
      maxAutoAllow: config.riskPolicy?.maxAutoAllow ?? 'high',
      onHighRisk: config.riskPolicy?.onHighRisk ?? 'delegate',
    },
    circuitBreaker: {
      consecutiveDenies: breaker.consecutiveDenies ?? 3,
      windowDenies: breaker.windowDenies ?? 10,
      windowSize: breaker.windowSize ?? 50,
      action: breaker.action ?? 'delegate',
    },
    overrideTtlMs: config.overrideTtlMs ?? 5 * 60_000,
    language: config.language ?? 'en',
  }
}
