/**
 * The reviewer subagent: one-shot in-process child with a read-only tool
 * allow-list and a structured verdict schema, raced against the configured
 * timeout and the request's cancellation signal. Any failure resolves to a
 * {@link ReviewFailure} — the caller applies the fallback policy, never a
 * grant (fail closed by default).
 * @module dsh-auto-review/review
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { CallId, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-subagent'
import { assertObjectJsonSchema, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { AutoReviewFallback } from './events.ts'
import { AutoReviewVerdictId, findPresentedCall } from './events.ts'
import type { ResolvedConfig, RiskLevel } from './config.ts'

/** A reviewer verdict, validated against the closed decision vocabulary. */
export interface ReviewerVerdict {
  readonly decision: 'allow' | 'deny'
  readonly reason: string
  readonly riskLevel?: RiskLevel
  /** The reviewer child's session id (its own log is auditable). */
  readonly reviewerSessionId?: SessionId
  /** The explicitly configured reviewer model, when one was set. */
  readonly model?: string
}

/**
 * A review that produced no verdict. The caller maps the failure to the
 * configured fallback policy.
 */
export interface ReviewFailure {
  readonly fallback: AutoReviewFallback
  readonly error: string
  readonly reviewerSessionId?: SessionId
  readonly model?: string
}

/** The closed result of one review attempt. */
export type ReviewResolution = ReviewerVerdict | ReviewFailure

/** Distinguish a verdict resolution from a failure. */
export function isReviewFailure(resolution: ReviewResolution): resolution is ReviewFailure {
  return (resolution as ReviewFailure).fallback !== undefined
}

/** Object-rooted verdict schema enforced on the child's structured_output capture. */
export const VERDICT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['allow', 'deny'] },
    reason: { type: 'string' },
    riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['decision', 'reason'],
}

// Prove at load time that the verdict schema obeys the enforced JSON-schema
// subset; a regression here must fail the plugin loudly, not every review.
assertObjectJsonSchema(VERDICT_SCHEMA)

/** Keys whose values are redacted from the reviewer prompt. */
const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|passwd|pwd|authorization|auth|credential|private[_-]?key|access[_-]?key)/iu

/** The redaction placeholder for sensitive argument values. */
const REDACTED = '[REDACTED]'

/**
 * Recursively redact sensitive values from a JSON value: any object key
 * matching {@link SENSITIVE_KEY_PATTERN} has its value replaced.
 * @param value - the detached JSON value to sanitize.
 * @returns a detached copy with sensitive values redacted.
 */
export function sanitizeArguments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => sanitizeArguments(item))
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      copy[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeArguments(item)
    }
    return copy
  }
  return value
}

/**
 * Render the tool-call context for the reviewer: the already-streamed call
 * arguments (parsed, redacted, truncated) or a note when the log lacks them.
 * @param events - the requesting session's log.
 * @param callId - the call to render.
 * @param maxChars - the preview cap (shared with reason truncation).
 * @returns the prompt section text.
 */
export function renderCallContext(events: readonly SessionEvent[], callId: CallId | undefined, maxChars: number): string {
  if (callId === undefined) return 'Tool call arguments: (not available — the asker attached no call id)'
  const raw = findPresentedCall(events, callId)
  if (raw === undefined) return 'Tool call arguments: (not found in the presented transcript)'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return 'Tool call arguments: (unparseable raw JSON omitted)'
  }
  let text: string
  try {
    text = JSON.stringify(sanitizeArguments(parsed), undefined, 2)
  } catch {
    text = String(parsed)
  }
  return `Tool call arguments (sensitive values redacted):\n${truncate(text, maxChars)}`
}

/**
 * Truncate a string to a character budget without cutting surrogate pairs.
 * @param text - the string to cap.
 * @param maxChars - the positive budget.
 * @returns the capped string.
 */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) return cut.slice(0, -1)
  return `${cut}…`
}

/**
 * Build the reviewer prompt: role, the pending request's tool/reason/context/
 * workspace, the resolved risk rules, and the verdict contract.
 * @param request - the pending approval request.
 * @param config - resolved config (rules, guidance, budgets).
 * @returns the exact prompt text block.
 */
export function buildReviewPrompt(request: ApprovalRequest, config: ResolvedConfig): string {
  const workspace = request.agent.session.header.cwd ?? '(unknown)'
  const rules = config.riskRules.length > 0
    ? config.riskRules.map(rule => `- reason matches /${rule.pattern}/u → ${rule.policy}`).join('\n')
    : '(no risk rules configured)'
  const guidance = config.reviewerGuidance === undefined
    ? ''
    : `\nAdditional reviewer guidance:\n${config.reviewerGuidance}\n`
  const context = renderCallContext(request.agent.session.events, request.callId, config.reasonMaxChars)
  return [
    'You are the auto-review safety reviewer of DeepSeek Harness. A tool call is about to',
    'cross a permission boundary and no human is available to decide it. Judge the call from',
    'the evidence below ONLY. You are a READ-ONLY reviewer: you cannot and must not execute',
    'or modify anything.',
    '',
    `Tool name: ${request.toolName}`,
    `Approval reason (from the calling agent): ${request.reason ?? '(none given)'}`,
    `Workspace: ${workspace}`,
    context,
    '',
    'Risk rules (the resolved policy already accounts for these; the first match won):',
    rules,
    guidance,
    'Verdict rules:',
    '- allow: the action is safe, reversible, within the stated scope, and its reason is plausible.',
    '- deny: the action is destructive, irreversible, credential- or data-exfiltrating, or the',
    '  evidence is insufficient to judge it. When unsure, DENY.',
    '- riskLevel: low / medium / high, your overall confidence-weighted severity.',
    '',
    'Report your decision by calling the structured_output tool EXACTLY ONCE with:',
    '{ "decision": "allow" | "deny", "reason": "<one or two sentences>", "riskLevel": "low" | "medium" | "high" }',
  ].join('\n')
}

/**
 * Validate the provider-validated structured capture against the closed
 * verdict vocabulary. The subagent seam validates against the schema, but its
 * result is typed `unknown`; this is the boundary that narrows it.
 * @param value - the captured structured value.
 * @param reasonMaxChars - the reason cap.
 * @returns the verdict, or undefined when the value cannot be a verdict.
 */
export function parseVerdict(value: unknown, reasonMaxChars: number): ReviewerVerdict | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const decision = record.decision
  if (decision !== 'allow' && decision !== 'deny') return undefined
  const reason = record.reason
  if (typeof reason !== 'string' || reason.trim().length === 0) return undefined
  const riskLevel = record.riskLevel
  if (riskLevel !== undefined && riskLevel !== 'low' && riskLevel !== 'medium' && riskLevel !== 'high') return undefined
  return {
    decision,
    reason: truncate(reason.trim(), reasonMaxChars),
    ...riskLevel === undefined ? {} : { riskLevel },
  }
}

/**
 * Run one review attempt: start a one-shot reviewer child on the configured
 * provider, await its structured verdict, and race both the configured
 * timeout and the request signal. Every failure path resolves to a
 * {@link ReviewFailure} — never to a grant.
 * @param ctx - the plugin context (`ctx.subagents` and the request's parent agent).
 * @param config - resolved config (provider, timeout, tools, model, budgets).
 * @param request - the pending approval request (parent, signal, and evidence).
 * @param reviewerSessions - the runtime's live reviewer session ids, so the
 *   answerer can refuse the child's own approval asks while the review runs.
 * @returns the verdict or the failure.
 */
export async function runReview(
  ctx: Context,
  config: ResolvedConfig,
  request: ApprovalRequest,
  reviewerSessions: Set<SessionId>,
): Promise<ReviewResolution> {
  const provider = config.reviewerProvider
  if (ctx.subagents.getProvider(provider) === undefined) {
    return { fallback: 'unavailable', error: `subagent provider "${provider}" is not registered` }
  }
  const prompt: ContentBlock[] = [{ type: 'text', text: buildReviewPrompt(request, config) }]
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.reviewerTimeoutMs)
  const onAbort = (): void => {
    controller.abort()
  }
  request.signal?.addEventListener('abort', onAbort, { once: true })
  let reviewerSessionId: SessionId | undefined
  let model: string | undefined
  const failure = (fallback: AutoReviewFallback, error: string): ReviewFailure => ({
    fallback,
    error,
    ...reviewerSessionId !== undefined ? { reviewerSessionId } : {},
    ...model !== undefined ? { model } : {},
  })
  try {
    const run = await ctx.subagents.start(provider, {
      label: `auto-review: ${request.toolName}`,
      prompt,
      parent: request.agent,
      signal: controller.signal,
      toolFilter: { allow: config.reviewerTools },
      outputSchema: VERDICT_SCHEMA,
      // The reviewer never delegates further: its computed depth exceeds this cap.
      maxDepth: 0,
      ...config.reviewerModel !== undefined ? { agentOptions: { model: config.reviewerModel } } : {},
    })
    reviewerSessionId = run.id
    reviewerSessions.add(run.id)
    model = config.reviewerModel
    const result = await run.result
    await run.dispose()
    if (timedOut) {
      return failure('timeout', `reviewer exceeded ${config.reviewerTimeoutMs} ms`)
    }
    if (request.signal?.aborted === true) {
      return failure('cancelled', 'approval request was cancelled while the reviewer ran')
    }
    if (result.stopReason !== 'completed') {
      return failure('unavailable', `reviewer ended with stopReason "${result.stopReason}"`)
    }
    const verdict = parseVerdict(result.structured, config.reasonMaxChars)
    if (verdict === undefined) {
      return failure('schema', 'reviewer returned no valid structured verdict')
    }
    return {
      ...verdict,
      ...reviewerSessionId !== undefined ? { reviewerSessionId } : {},
      ...model !== undefined ? { model } : {},
    }
  } catch (error: unknown) {
    return failure('unavailable', `reviewer subagent failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (reviewerSessionId !== undefined) reviewerSessions.delete(reviewerSessionId)
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onAbort)
  }
}

/**
 * Mint one verdict id. Wrapped for testability (audit uniqueness is a UUID).
 * @returns a fresh branded id.
 */
export function newVerdictId(): AutoReviewVerdictId {
  return AutoReviewVerdictId(randomUUID())
}
