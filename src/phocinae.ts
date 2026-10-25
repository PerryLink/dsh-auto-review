/**
 * The local non-generative reviewer: one typed decision from the Phocinae
 * decision service (`phocinae-server`, model `Phocinae-Largha-150M-v1`).
 *
 * The model does not generate tokens. It reads one rendered decision state and
 * answers a typed question — a boolean, an option index, or a 2..10 level — so
 * a review is one forward pass instead of a generation: offline, deterministic,
 * and ~21 ms warm on a GPU (~1.5 s single-threaded on CPU). That makes it a
 * useful reviewer for offline/air-gapped deployments and for hosts where the
 * generative reviewer's route is unavailable or too slow.
 *
 * Contract notes this module depends on (measured against `phocinae-server`
 * 0.1.8 and the sibling `dsh-phocinae` client):
 *
 *  - The endpoint is `POST /v1/systemone` with `{ model, state, questions }`.
 *  - Answers are keyed by question id: `answers: { <id>: value }`. Treating
 *    that object as an array yields `undefined` for every question — the exact
 *    mistake that once turned the sibling gate into an always-allow gate.
 *  - The optional `answer_confidence` extension carries the calibrated top
 *    probability. Absent or below the floor, an `allow` is NOT a verdict; a
 *    `deny` always stands (fail closed).
 *  - The state carries the reviewed call's text, so the endpoint is loopback
 *    unless `phocinae.allowRemoteEndpoint` says otherwise.
 *
 * Every failure resolves to a {@link PhocinaeFailure} carrying the vocabulary
 * the answerer already understands (`timeout` | `cancelled` | `unavailable` |
 * `schema`), never to a grant.
 * @module dsh-auto-review/phocinae
 */

import type { AutoReviewFallback } from './events.ts'
import {
  PHOCINAE_DEFAULT_MODEL,
  type ResolvedConfig,
  type ResolvedPhocinaeConfig,
  type RiskLevel,
} from './config.ts'

/** One question kind served by `/v1/systemone` that this reviewer uses. */
export type PhocinaeQuestionType = 'choice' | 'noul'

/** One typed question, shaped like the server's request contract. */
export interface PhocinaeQuestion {
  readonly id: string
  readonly type: PhocinaeQuestionType
  /** `choice` only: candidate strings, indexed in this order. */
  readonly options?: readonly string[]
}

/** The candidate strings for the default `harm` question, strongest first. */
export const PHOCINAE_HARM_OPTIONS: readonly string[] = ['harmless', 'risky', 'destructive']

/** The candidate strings for the `tri-state` question. */
export const PHOCINAE_TRI_STATE_OPTIONS: readonly string[] = ['allow', 'ask', 'deny']

/** A pending human one-shot override, rendered into the decision state. */
export interface PhocinaeOverrideContext {
  readonly reviewId: string
  readonly toolName: string
}

/** The evidence one review shows the decision model (already redacted). */
export interface PhocinaeEvidence {
  /** The tool about to run. */
  readonly toolName: string
  /** The calling model's approval reason, redacted and truncated by the caller. */
  readonly reason: string
  /** The session's working directory (a deletion inside a workspace differs from one outside it). */
  readonly workspace: string
  /** `process.platform` of the harness host. */
  readonly platform: string
  /** The pending call's redacted argument text, when the log has it. */
  readonly argumentsText?: string
  /** A pending human authorization, when one applies. */
  readonly override?: PhocinaeOverrideContext
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
 * Cap the decision state, keeping its head and marking the cut. The head of the
 * call carries the verb and its target, which is what the model needs; the cut
 * is disclosed so a partial view is never mistaken for the whole command.
 * @param state - the rendered state.
 * @param maxChars - the positive character budget.
 * @returns the capped text and whether anything was removed.
 */
function clampState(state: string, maxChars: number): { text: string; truncated: boolean } {
  if (state.length <= maxChars) return { text: state, truncated: false }
  return { text: `${state.slice(0, maxChars)}${TRUNCATION_MARK}`, truncated: true }
}

/**
 * Render the decision state: tool, platform, workspace, the reason, and the
 * redacted arguments. Mirrors the sibling gate's `renderToolCall` so one
 * server's calibration applies to both.
 * @param evidence - the redacted evidence.
 * @param maxChars - the state budget.
 * @returns the state text and whether it was truncated.
 */
export function renderPhocinaeState(
  evidence: PhocinaeEvidence,
  maxChars: number,
): { text: string; truncated: boolean } {
  const lines = [
    `tool: ${evidence.toolName}`,
    `platform: ${evidence.platform}`,
    `cwd: ${evidence.workspace}`,
    `reason: ${evidence.reason}`,
  ]
  if (evidence.argumentsText !== undefined) {
    lines.push('arguments:', evidence.argumentsText)
  } else {
    lines.push('arguments: (not available in the presented transcript)')
  }
  if (evidence.override !== undefined) {
    lines.push(
      'human override: the user explicitly authorized ONE retry of the previously',
      `denied action (review ${evidence.override.reviewId}, tool ${evidence.override.toolName}).`,
      'This does not force an allow; weigh it as strong evidence of legitimacy.',
    )
  }
  return clampState(lines.join('\n'), maxChars)
}

/**
 * Build the request for one review: the question depends on
 * {@link PhocinaeConfig.mode}. `harm` is the default because it measured 0.97
 * recall on destructive commands in the sibling plugin's labelled set; the
 * tri-state question scored 0.74 and the boolean one 0.00.
 * @param evidence - the redacted evidence.
 * @param config - the resolved Phocinae settings.
 * @returns the plan.
 */
export function buildPhocinaeRequest(evidence: PhocinaeEvidence, config: ResolvedPhocinaeConfig): PhocinaeRequestPlan {
  const { text, truncated } = renderPhocinaeState(evidence, config.maxStateChars)
  const model = config.model
  if (config.mode === 'harm') {
    return {
      body: {
        model,
        state: `${text}\n\nHow harmful is this tool call if it runs?`,
        questions: [{ id: 'harm', type: 'choice', options: PHOCINAE_HARM_OPTIONS }],
      },
      questionId: 'harm',
      questionType: 'choice',
      truncated,
    }
  }
  if (config.mode === 'tri-state') {
    return {
      body: {
        model,
        state: `${text}\n\nShould this tool call run, be reviewed by a human first, or be blocked?`,
        questions: [{ id: 'action', type: 'choice', options: PHOCINAE_TRI_STATE_OPTIONS }],
      },
      questionId: 'action',
      questionType: 'choice',
      truncated,
    }
  }
  return {
    body: {
      model,
      state: `${text}\n\nShould this tool call be blocked for safety?`,
      questions: [{ id: 'risk', type: 'noul' }],
    },
    questionId: 'risk',
    questionType: 'noul',
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
  let answer: boolean | number
  if (plan.questionType === 'noul') {
    if (typeof raw === 'boolean') answer = raw
    else if (raw === 'true') answer = true
    else if (raw === 'false') answer = false
    else throw new PhocinaeProtocolError(`answer for ${JSON.stringify(plan.questionId)} was ${JSON.stringify(raw)}, expected a boolean`)
  } else {
    const options = plan.body.questions[0]?.options ?? []
    const index = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isInteger(index) || index < 0 || index >= options.length) {
      throw new PhocinaeProtocolError(
        `answer for ${JSON.stringify(plan.questionId)} was ${JSON.stringify(raw)}, expected a 0-based index below ${options.length}`,
      )
    }
    answer = index
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
  return { answer, confidence }
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
 * Only a `harmless` (`harm` mode), `allow` (`tri-state`), or "not blocked"
 * (`noul`) answer can allow. Any other answer denies — `ask`/`risky` included,
 * because auto-review has no verdict that hands a request to a human; the
 * configured `fallbackPolicy` already owns that path, and a low-confidence
 * allow resolves through it rather than becoming a grant.
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
  let decision: 'allow' | 'deny'
  let riskLevel: RiskLevel
  let label: string
  if (plan.questionType === 'noul') {
    const blocked = parsed.answer === true
    decision = blocked ? 'deny' : 'allow'
    riskLevel = blocked ? 'high' : 'low'
    label = blocked ? 'answered that the call should be blocked' : 'answered that the call need not be blocked'
  } else {
    const index = parsed.answer as number
    if (config.mode === 'tri-state') {
      decision = index === 0 ? 'allow' : 'deny'
      riskLevel = index === 0 ? 'low' : index === 1 ? 'medium' : 'high'
      label = index === 0 ? 'answered "allow"' : index === 1 ? 'answered "ask" (a human would have to decide)' : 'answered "deny"'
    } else {
      decision = index === 0 ? 'allow' : 'deny'
      riskLevel = index === 0 ? 'low' : index === 1 ? 'medium' : 'high'
      label = index === 0 ? 'answered "harmless"' : index === 1 ? 'answered "risky"' : 'answered "destructive"'
    }
  }
  if (decision === 'deny') {
    return {
      decision,
      riskLevel,
      model,
      reason: `phocinae (${model}) ${label} (${shown}); the local decision service did not clear this call.`,
    }
  }
  if (plan.truncated) {
    return {
      fallback: 'unavailable',
      model,
      error: `phocinae (${model}) ${label} (${shown}), but the decision state was truncated at `
        + `phocinae.maxStateChars (${config.maxStateChars}); an allow cannot rest on partial evidence`,
    }
  }
  if (confidence === undefined) {
    return {
      fallback: 'unavailable',
      model,
      error: `phocinae (${model}) ${label} without a calibrated confidence; an allow requires `
        + `answer_confidence >= ${config.minConfidence}`,
    }
  }
  if (confidence < config.minConfidence) {
    return {
      fallback: 'unavailable',
      model,
      error: `phocinae (${model}) ${label} with confidence ${confidence.toFixed(2)}, below `
        + `minConfidence ${config.minConfidence}; an unsure allow is not a verdict`,
    }
  }
  return {
    decision,
    riskLevel,
    model,
    reason: `phocinae (${model}) ${label} (${shown} >= ${config.minConfidence}); the local decision service cleared this call.`,
  }
}

/**
 * Ask the local decision service for one verdict, raced against the HTTP
 * deadline (bounded by the reviewer deadline) and the request's cancellation
 * signal. One attempt, no retry. Every abnormal path is a
 * {@link PhocinaeFailure}, never a grant.
 * @param evidence - the redacted evidence (built by the caller).
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
  const plan = buildPhocinaeRequest(evidence, phocinae)
  const model = phocinae.model
  const failure = (fallback: AutoReviewFallback, error: string): PhocinaeFailure => ({
    fallback,
    error: truncateText(error, Math.max(config.reasonMaxChars, 300)),
    model,
  })
  // A local predicate, not a direct property read: the early return above
  // narrows `signal.aborted` to false for the rest of the function, and the
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

/** Re-exported so callers can name the published model without importing config. */
export const PHOCINAE_MODEL = PHOCINAE_DEFAULT_MODEL
