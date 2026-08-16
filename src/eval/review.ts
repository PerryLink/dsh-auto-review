/**
 * The dsh-eval second-model review layer: a supplementary assertion over a
 * finished case run. It reuses the SAME subagent seam as the approval
 * reviewer (`ctx.subagents`, toolFilter allow-list, structured output
 * schema, timeout + abort racing) but with an evaluation-specific prompt —
 * one sentence of role statement first, kept short — and a
 * `{ pass, reason }` verdict.
 *
 * The review is an assertion layer, not a replacement for the structured
 * assertions: both verdicts land in the report, and either failing fails
 * the case.
 * @module dsh-auto-review/eval/review
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subagent'
import { assertObjectJsonSchema, type ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type { EvalCase } from './dsl.ts'
import type { CaseTrace } from './trace.ts'
import { renderToolCall } from './trace.ts'

/** A second-model evaluation verdict. */
export interface EvalReviewVerdict {
  readonly pass: boolean
  readonly reason: string
}

/** Why the review produced no verdict. */
export type EvalReviewFailureKind = 'timeout' | 'cancelled' | 'unavailable' | 'schema'

/** A review that produced no verdict. */
export interface EvalReviewFailure {
  readonly failure: EvalReviewFailureKind
  readonly error: string
  readonly model?: string
  readonly reviewerSessionId?: string
}

/** The closed result of one evaluation review. */
export type EvalReviewResolution = EvalReviewVerdict | EvalReviewFailure

/** Distinguish a verdict from a failure. */
export function isEvalReviewFailure(resolution: EvalReviewResolution): resolution is EvalReviewFailure {
  return (resolution as EvalReviewFailure).failure !== undefined
}

/** Object-rooted evaluation verdict schema enforced on the child's structured_output capture. */
export const EVAL_VERDICT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['pass', 'reason'],
}

// Prove at load time that the schema obeys the enforced JSON-schema subset.
assertObjectJsonSchema(EVAL_VERDICT_SCHEMA)

/** The engine-side review configuration (reuses the approval-reviewer knobs). */
export interface EvalReviewConfig {
  /** Subagent provider name for the reviewer. */
  readonly reviewerProvider: string
  /** Reviewer model id; unset inherits the case agent's route. */
  readonly reviewerModel?: string | undefined
  /** Verdict deadline in milliseconds. */
  readonly reviewerTimeoutMs: number
  /** Reviewer tool allow-list (read-only tools). */
  readonly reviewerTools: readonly string[]
}

/**
 * Build the evaluation review prompt: one sentence of role statement, then
 * the case task, the expected behavior, and the actual evidence (final
 * output and compact tool-call trace), then the verdict contract.
 * @param caze - the case under review.
 * @param trace - the collected trace.
 * @returns the exact prompt text block.
 */
export function buildEvalReviewPrompt(caze: EvalCase, trace: CaseTrace): string {
  const criteria = caze.review?.criteria ?? []
  const expectedLines = [
    `- ${caze.review?.statement ?? '(no statement)'}`,
    ...criteria.map(item => `- ${item}`),
  ]
  const toolSection = trace.toolCalls.length === 0
    ? '(the run made no tool calls)'
    : trace.toolCalls.map(renderToolCall).join('\n')
  const output = trace.finalOutput === ''
    ? '(the run produced no final text)'
    : trace.finalOutput.slice(0, 4000)
  return [
    'You are the eval reviewer of the dsh-eval engine. You judge whether one finished',
    'agent run satisfies its expected behavior and report a pass/fail verdict.',
    '',
    `Case: ${caze.id}`,
    `Task: ${caze.input.slice(0, 2000)}`,
    '',
    'Expected behavior:',
    ...expectedLines,
    '',
    'Actual final output:',
    output,
    '',
    'Actual tool calls (name, arguments, result):',
    toolSection,
    '',
    'Judge only from the evidence above. Pass when the expected behavior holds;',
    'otherwise fail. Report your decision by calling the structured_output tool',
    'EXACTLY ONCE with:',
    '{ "pass": true | false, "reason": "<one or two sentences>" }',
  ].join('\n')
}

/** Parse the structured capture into a closed verdict. */
function parseEvalVerdict(value: unknown): EvalReviewVerdict | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.pass !== 'boolean') return undefined
  const reason = record.reason
  if (typeof reason !== 'string' || reason.trim().length === 0) return undefined
  return { pass: record.pass, reason: reason.trim() }
}

/**
 * Run one evaluation review: a one-shot reviewer child on the configured
 * provider, raced against the timeout and the run's cancellation signal.
 * Every failure path resolves to an {@link EvalReviewFailure} — the caller
 * records it and marks the case `error` (a review is part of the case
 * definition; an unavailable reviewer cannot be silently skipped).
 * @param ctx - the engine context (`ctx.subagents`).
 * @param config - the review configuration.
 * @param parent - the still-live case agent (the reviewer's parent).
 * @param caze - the case.
 * @param trace - the collected trace.
 * @param signal - the run's cancellation signal.
 * @returns the verdict or the failure.
 */
export async function runEvalReview(
  ctx: Context,
  config: EvalReviewConfig,
  parent: Agent,
  caze: EvalCase,
  trace: CaseTrace,
  signal: AbortSignal,
): Promise<EvalReviewResolution> {
  const provider = config.reviewerProvider
  const providerInfo = ctx.subagents.getProvider(provider)
  if (providerInfo === undefined) {
    return { failure: 'unavailable', error: `subagent provider "${provider}" is not registered` }
  }
  const capabilities = providerInfo.capabilities
  if (capabilities?.outputSchema === false) {
    return { failure: 'unavailable', error: `subagent provider "${provider}" does not support outputSchema, which the structured verdict requires` }
  }
  if (capabilities?.toolFilter === false) {
    return { failure: 'unavailable', error: `subagent provider "${provider}" does not support toolFilter, which the read-only reviewer face requires` }
  }
  const reviewerModel = caze.review?.model ?? config.reviewerModel
  const prompt: ContentBlock[] = [{ type: 'text', text: buildEvalReviewPrompt(caze, trace) }]
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.reviewerTimeoutMs)
  const onAbort = (): void => {
    controller.abort()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  let reviewerSessionId: SessionId | undefined
  let run: import('@deepseek-ai/dsh-subagent').SubagentRun | undefined
  const failure = (kind: EvalReviewFailureKind, error: string): EvalReviewFailure => ({
    failure: kind,
    error,
    ...reviewerSessionId !== undefined ? { reviewerSessionId: reviewerSessionId as string } : {},
    ...reviewerModel !== undefined ? { model: reviewerModel } : {},
  })
  try {
    run = await ctx.subagents.start(provider, {
      label: `eval-review: ${caze.id}`,
      prompt,
      parent,
      signal: controller.signal,
      toolFilter: { allow: config.reviewerTools },
      outputSchema: EVAL_VERDICT_SCHEMA,
      maxDepth: (parent.session.header.delegationDepth ?? 0) + 1,
      ...reviewerModel !== undefined ? { agentOptions: { model: reviewerModel } } : {},
    })
    reviewerSessionId = run.id
    const result = await run.result
    if (timedOut) return failure('timeout', `reviewer exceeded ${config.reviewerTimeoutMs} ms`)
    if (signal.aborted) return failure('cancelled', 'the eval run was cancelled while the reviewer ran')
    if (result.stopReason !== 'completed') return failure('unavailable', `reviewer ended with stopReason "${result.stopReason}"`)
    const verdict = parseEvalVerdict(result.structured)
    if (verdict === undefined) return failure('schema', 'reviewer returned no valid structured verdict')
    return verdict
  } catch (error: unknown) {
    if (timedOut) return failure('timeout', `reviewer exceeded ${config.reviewerTimeoutMs} ms`)
    if (signal.aborted) return failure('cancelled', 'the eval run was cancelled before the reviewer delivered')
    return failure('unavailable', `reviewer subagent failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (run !== undefined) await run.dispose()
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}
