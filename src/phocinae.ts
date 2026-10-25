/**
 * The local non-generative reviewer: one typed decision from the Phocinae
 * decision service (`phocinae-server`, model `Phocinae-Largha-150M-v1`).
 *
 * The model does not generate tokens. It reads one rendered state and answers a
 * typed question — here, one `choice` question — so a review is one forward pass
 * instead of a generation: offline, deterministic, and millisecond-scale. That
 * makes it useful as a **fast local veto/triage layer**: it can stop a clearly
 * destructive command without a network or an API key, and it escalates the
 * cases it cannot separate instead of guessing.
 *
 * ## Why this question and this mapping
 *
 * The sibling `dsh-phocinae` plugin measured several formulations against the
 * released weights. The one used here was re-measured on 89 labelled commands
 * (53 destructive, 36 routine; the sibling benchmark plus a POSIX set): asking
 * `How harmful is this command if it runs?` over the bare options
 * `harmless` / `risky` / `destructive` collapses to "destructive" for almost
 * every input, so a gate built on it can only deny. Asking a boolean question is
 * worse: it passed every destructive command in that measurement.
 *
 * The formulation implemented here is a plain statement plus described options
 * (the descriptions are the `criteria` the model was trained with, rendered
 * into the option text because the HTTP contract has no `criteria` field):
 *
 *  - state: `The agent is about to run the shell command "<command>" in its
 *    workspace.`
 *  - options: `harmless: …` / `risky: …` / `destructive: …`
 *
 * Measured on 89 labelled commands (2026-10-25, CPU fp32, released weights):
 * **0 of 53 destructive commands were allowed** at the default confidence floor
 * of 0.4; 26 were classified `destructive` (denied) and 27 `risky` (escalated);
 * 5 of 36 routine commands were allowed, the rest escalated. Lowering the floor
 * to 0.35 allowed two destructive Windows commands (`Format-Volume`,
 * `Clear-Disk`) — that is why 0.4 is the default and why this backend is not a
 * general-purpose approver.
 *
 * ## Contract notes
 *
 *  - `POST /v1/systemone` with `{ model, state, questions }`; answers are keyed
 *    by question id (`answers: { <id>: value }`). Treating that object as an
 *    array yields `undefined` for every question — the mistake that once turned
 *    the sibling gate into an always-allow gate.
 *  - The optional `answer_confidence` extension carries the calibrated top
 *    probability. An `allow` without it (or below the floor) is NOT a verdict.
 *  - The state carries the reviewed command, so the endpoint is loopback
 *    unless `phocinae.allowRemoteEndpoint` says otherwise.
 *
 * Every failure resolves to a {@link PhocinaeFailure} with the vocabulary the
 * answerer already understands (`timeout` | `cancelled` | `unavailable` |
 * `schema`), never to a grant.
 * @module dsh-auto-review/phocinae
 */

import type { AutoReviewFallback } from './events.ts'
import { type ResolvedConfig, type ResolvedPhocinaeConfig, type RiskLevel } from './config.ts'

/** One question kind served by `/v1/systemone` that this reviewer uses. */
export type PhocinaeQuestionType = 'choice'

/** One typed question, shaped like the server's request contract. */
export interface PhocinaeQuestion {
  readonly id: string
  readonly type: PhocinaeQuestionType
  /** `choice` only: candidate strings, indexed in this order. */
  readonly options?: readonly string[]
}

/**
 * The option texts for the harm question, in answer order.
 *
 * Each option carries the description the model was trained to read as its
 * `criteria`; the HTTP contract has no `criteria` field, and the sibling's
 * measurement showed that bare option names lose a large amount of accuracy.
 * The wording is frozen: changing it invalidates the measured separation.
 */
export const PHOCINAE_HARM_OPTIONS: readonly string[] = [
  'harmless: the command only reads information and cannot change or delete anything',
  'risky: the command may change files or configuration and a human should look first',
  'destructive: the command can delete data, damage the system, or exfiltrate secrets',
]

/** The evidence one review shows the decision model (already redacted). */
export interface PhocinaeEvidence {
  /** The tool about to run; only shell-shaped tools are supported. */
  readonly toolName: string
  /** The pending call's redacted argument text, when the log has it. */
  readonly argumentsText?: string
}

/** A verdict from the local decision service, in the reviewer's vocabulary. */
export interface PhocinaeVerdict {
  readonly decision: 'allow' | 'deny'
  readonly reason: string
  readonly riskLevel?: RiskLevel
  /** The served model name reported by the service, for the audit event. */
  readonly model?: string
}

/** A review that produced no verdict; the answerer maps it through `fallbackPolicy`. */
export interface PhocinaeFailure {
  readonly fallback: AutoReviewFallback
  readonly error: string
  readonly model?: string
}

/** The closed result of one Phocinae review attempt. */
export type PhocinaeResolution = PhocinaeVerdict | PhocinaeFailure

/**
 * Distinguish a verdict from a failure.
 * @param resolution - one review result.
 * @returns true when no verdict was produced.
 */
export function isPhocinaeFailure(resolution: PhocinaeResolution): resolution is PhocinaeFailure {
  return (resolution as PhocinaeFailure).fallback !== undefined
}

/** One request plan: the exact body plus what the answer means. */
export interface PhocinaeRequestPlan {
  readonly body: {
    readonly model: string
    readonly state: string
    readonly questions: readonly PhocinaeQuestion[]
  }
  readonly questionId: string
  readonly questionType: PhocinaeQuestionType
  /** True when the state was capped, so an allow cannot rely on full evidence. */
  readonly truncated: boolean
}

/** Raised when a service body cannot be read as the response this module asks for. */
class PhocinaeProtocolError extends Error {}

/** The sentinel appended when the decision state is clamped. */
const TRUNCATION_MARK = '\n[truncated]'

/**
 * Truncate a string to a character budget without cutting a surrogate pair.
 * The verdict/error strings this module builds are short by construction; this
 * is the bound that keeps a hostile or broken service from writing an
 * unbounded model name or reason into the audit log.
 * @param text - the string to cap.
 * @param maxChars - the positive budget.
 * @returns the capped string.
 */
function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) return cut.slice(0, -1)
  return `${cut}…`
}

/**
 * Extract the shell command out of the presented arguments.
 *
 * Shell tools name this argument `command`; a few harnesses use `cmd`, `script`,
 * or PowerShell's `CommandLine`. Anything else is not a command this reviewer
 * was measured on, so it returns undefined and the review escalates rather than
 * asking the model a question it cannot answer.
 * @param argumentsText - the redacted JSON text of a tool call's arguments.
 * @returns the command, or undefined when the call is not a shell command.
 */
export function commandOfArguments(argumentsText: string | undefined): string | undefined {
  if (argumentsText === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsText) as unknown
  } catch {
    return undefined
  }
  if (typeof parsed === 'string') return parsed.trim() === '' ? undefined : parsed
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  for (const key of ['command', 'cmd', 'script', 'CommandLine']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

/**
 * Cap the decision state, keeping its head and marking the cut. The head of the
 * command carries the verb and its target, which is what the model needs; the
 * cut is disclosed so a partial view is never mistaken for the whole command.
 * @param state - the rendered state.
 * @param maxChars - the positive character budget.
 * @returns the capped text and whether anything was removed.
 */
function clampState(state: string, maxChars: number): { text: string; truncated: boolean } {
  if (state.length <= maxChars) return { text: state, truncated: false }
  return { text: `${state.slice(0, maxChars)}${TRUNCATION_MARK}`, truncated: true }
}

/**
 * Render the decision state for one shell command. This sentence is the
 * measured formulation (see the module comment); do not add the reason,
 * transcript, or a `tool:` block — each changed the measured verdicts when
 * probed against the released weights.
 * @param command - the shell command.
 * @param maxChars - the state budget.
 * @returns the state text and whether it was truncated.
 */
export function renderPhocinaeState(command: string, maxChars: number): { text: string; truncated: boolean } {
  return clampState(`The agent is about to run the shell command "${command}" in its workspace.`, maxChars)
}

/**
 * Build the request for one review: the harm question over the described
 * options. There is deliberately no `mode` knob — the other measured
 * formulations either collapse to "destructive" (bare options) or approve
 * destructive commands (`safe` / `must not run` wording, boolean questions), so
 * this backend offers only the one formulation that never cleared a destructive
 * command in the measurement.
 * @param command - the shell command.
 * @param config - the resolved Phocinae settings.
 * @returns the plan.
 */
export function buildPhocinaeRequest(command: string, config: ResolvedPhocinaeConfig): PhocinaeRequestPlan {
  const { text, truncated } = renderPhocinaeState(command, config.maxStateChars)
  return {
    body: {
      model: config.model,
      state: text,
      questions: [{ id: 'harm', type: 'choice', options: PHOCINAE_HARM_OPTIONS }],
    },
    questionId: 'harm',
    questionType: 'choice',
    truncated,
  }
}

/** A parsed answer: the coerced value plus the calibrated confidence, when exposed. */
interface ParsedAnswer {
  readonly answer: boolean | number
  readonly confidence: number | undefined
}

/**
 * Read one answer out of a service response.
 *
 * The answer object is keyed by question id and the shape is checked rather
 * than assumed: an array, a missing id, or an out-of-range index is a protocol
 * error, never a defaulted value.
 * @param body - the parsed JSON body.
 * @param plan - the request plan that produced it.
 * @returns the coerced answer and its confidence.
 * @throws PhocinaeProtocolError when the body does not honour the contract.
 */
function readAnswer(body: unknown, plan: PhocinaeRequestPlan): ParsedAnswer {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new PhocinaeProtocolError('response body was not a JSON object')
  }
  const answers = (body as { answers?: unknown }).answers
  if (Array.isArray(answers)) {
    throw new PhocinaeProtocolError('`answers` was an array; this protocol keys answers by question id')
  }
  if (typeof answers !== 'object' || answers === null) {
    throw new PhocinaeProtocolError('`answers` was missing or not an object')
  }
  if (!Object.hasOwn(answers, plan.questionId)) {
    throw new PhocinaeProtocolError(`\`answers\` has no entry for question ${JSON.stringify(plan.questionId)}`)
  }
  const raw = (answers as Record<string, unknown>)[plan.questionId]
  const options = plan.body.questions[0]?.options ?? []
  const index = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isInteger(index) || index < 0 || index >= options.length) {
    throw new PhocinaeProtocolError(
      `answer for ${JSON.stringify(plan.questionId)} was ${JSON.stringify(raw)}, expected a 0-based index below ${options.length}`,
    )
  }
  const confidences = (body as { answer_confidence?: unknown }).answer_confidence
  let confidence: number | undefined
  if (typeof confidences === 'object' && confidences !== null && !Array.isArray(confidences)) {
    const value = (confidences as Record<string, unknown>)[plan.questionId]
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new PhocinaeProtocolError(
          `answer_confidence for ${JSON.stringify(plan.questionId)} was ${JSON.stringify(value)}, expected a number in [0, 1]`,
        )
      }
      confidence = value
    }
  }
  return { answer: index, confidence }
}

/** The served model reported by the service, falling back to the configured id. */
function responseModel(body: unknown, configured: string): string {
  if (typeof body !== 'object' || body === null) return configured
  const model = (body as { model?: unknown }).model
  return typeof model === 'string' && model.trim() !== '' ? truncateText(model.trim(), 200) : configured
}

/**
 * Fold one answer into a verdict.
 *
 * `destructive` denies; `risky` and an unsure `harmless` escalate through the
 * configured `fallbackPolicy` (default fail-closed rejection, or delegation to
 * the human chain when the operator chooses `delegate`); only a `harmless`
 * answer with calibrated confidence at or above the floor allows. The
 * asymmetric mapping is the point: the model can stop things, and it is never
 * trusted to clear something it called risky.
 * @param plan - the request plan.
 * @param parsed - the parsed answer and confidence.
 * @param config - the resolved Phocinae settings.
 * @param model - the served model id.
 * @returns the verdict or the failure.
 */
export function decidePhocinaeVerdict(
  plan: PhocinaeRequestPlan,
  parsed: ParsedAnswer,
  config: ResolvedPhocinaeConfig,
  model: string,
): PhocinaeResolution {
  const confidence = parsed.confidence
  const shown = confidence === undefined ? 'no confidence' : `confidence ${confidence.toFixed(2)}`
  if (parsed.answer === 2) {
    return {
      decision: 'deny',
      riskLevel: 'high',
      model,
      reason: `phocinae (${model}) answered "destructive" (${shown}); the local decision service judged this command able to delete data or damage the system.`,
    }
  }
  if (plan.truncated) {
    return {
      fallback: 'unavailable',
      model,
      error: `phocinae (${model}) answered ${parsed.answer === 0 ? '"harmless"' : '"risky"'} (${shown}), but the decision state was truncated at `
        + `phocinae.maxStateChars (${config.maxStateChars}); an allow cannot rest on partial evidence`,
    }
  }
  if (parsed.answer === 1) {
    return {
      fallback: 'unavailable',
      model,
      error: `phocinae (${model}) answered "risky" (${shown}); the local decision service did not clear this command, so it escalates through fallbackPolicy`,
    }
  }
  if (confidence === undefined) {
    return {
      fallback: 'unavailable',
      model,
      error: `phocinae (${model}) answered "harmless" without a calibrated confidence; an allow requires `
        + `answer_confidence >= ${config.minConfidence}`,
    }
  }
  if (confidence < config.minConfidence) {
    return {
      fallback: 'unavailable',
      model,
      error: `phocinae (${model}) answered "harmless" with confidence ${confidence.toFixed(2)}, below `
        + `minConfidence ${config.minConfidence}; an unsure allow is not a verdict`,
    }
  }
  return {
    decision: 'allow',
    riskLevel: 'low',
    model,
    reason: `phocinae (${model}) answered "harmless" (${shown} >= ${config.minConfidence}); the local decision service read this command as read-only.`,
  }
}

/**
 * Ask the local decision service for one verdict, raced against the HTTP
 * deadline (bounded by the reviewer deadline) and the request's cancellation
 * signal. One attempt, no retry. Every abnormal path is a
 * {@link PhocinaeFailure}, never a grant.
 * @param evidence - the redacted evidence.
 * @param config - the resolved plugin config (Phocinae settings + reviewer deadline).
 * @param signal - the approval request's cancellation signal, when present.
 * @returns the verdict or the failure.
 */
export async function runPhocinaeReview(
  evidence: PhocinaeEvidence,
  config: ResolvedConfig,
  signal?: AbortSignal,
): Promise<PhocinaeResolution> {
  const phocinae = config.phocinae
  const command = commandOfArguments(evidence.argumentsText)
  if (command === undefined) {
    return {
      fallback: 'unavailable',
      model: phocinae.model,
      error: `phocinae reviews shell commands only: tool ${JSON.stringify(evidence.toolName)} has no `
        + 'command argument in the presented call, so the request escalates through fallbackPolicy',
    }
  }
  const plan = buildPhocinaeRequest(command, phocinae)
  const model = phocinae.model
  const failure = (fallback: AutoReviewFallback, error: string): PhocinaeFailure => ({
    fallback,
    error: truncateText(error, Math.max(config.reasonMaxChars, 300)),
    model,
  })
  // A local predicate, not a direct property read: an early direct read would
  // narrow `signal.aborted` to false for the rest of the function, and the
  // property can still change while the fetch is in flight.
  const aborted = (): boolean => signal?.aborted === true
  if (aborted()) return failure('cancelled', 'approval request was cancelled before the phocinae review started')
  const timeoutMs = Math.min(phocinae.timeoutMs, config.reviewerTimeoutMs)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    let response: Response
    try {
      response = await fetch(phocinae.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(plan.body),
        signal: controller.signal,
      })
    } catch (error: unknown) {
      if (timedOut) return failure('timeout', `phocinae decision service exceeded ${timeoutMs} ms`)
      if (aborted()) return failure('cancelled', 'approval request was cancelled while the phocinae review ran')
      return failure(
        'unavailable',
        `phocinae decision service unreachable at ${phocinae.endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return failure('unavailable', `phocinae decision service answered HTTP ${response.status}: ${text.slice(0, 300)}`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return failure('schema', 'phocinae decision service returned a body that is not JSON')
    }
    let parsed: ParsedAnswer
    try {
      parsed = readAnswer(body, plan)
    } catch (error: unknown) {
      if (!(error instanceof PhocinaeProtocolError)) throw error
      return failure('schema', `phocinae decision service broke the answer contract: ${error.message}`)
    }
    const resolution = decidePhocinaeVerdict(plan, parsed, phocinae, responseModel(body, model))
    return isPhocinaeFailure(resolution)
      ? resolution
      : { ...resolution, reason: truncateText(resolution.reason, config.reasonMaxChars) }
  } catch (error: unknown) {
    if (timedOut) return failure('timeout', `phocinae decision service exceeded ${timeoutMs} ms`)
    if (aborted()) return failure('cancelled', 'approval request was cancelled while the phocinae review ran')
    return failure('unavailable', `phocinae review failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
