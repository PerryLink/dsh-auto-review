/**
 * The dsh-eval runner: executes a validated suite as isolated headless
 * agent sessions (one fresh agent + scratch workspace per case, mirroring
 * the official `dsh --profile headless` driver: `ctx.agents.create` →
 * `followup` → `whenIdle` → session flush), collects the tool-call trace
 * from the session event log, runs the structured assertions, then the
 * optional second-model review as a supplementary assertion layer.
 *
 * Engineering contracts:
 * - Per-case cancellation: a run-level `AbortSignal` stops scheduling and
 *   aborts active turns; a per-case timeout cancels only that agent.
 * - Concurrency: a worker pool bounded by the configured cap.
 * - No hardcoded model/timeout defaults: the runner validates every case's
 *   model and timeout resolution BEFORE starting any agent and fails the
 *   suite loudly on a case that resolves neither.
 * - Isolation: fresh session id, fresh scratch cwd, no cross-case state.
 * @module dsh-auto-review/eval/runner
 */

import { randomUUID } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, packChunkRuns } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionEvent } from '@deepseek-ai/dsh-session'
import { sessionEvents } from '../session-events.ts'
import type { ResolvedConfig } from '../config.ts'
import { runAssertions, validateExpectations } from './assert.ts'
import type { AssertionResult } from './assert.ts'
import type { EvalCase, EvalSuite, ResolvedModelTable } from './dsl.ts'
import { resolveCaseModel, resolveCaseTimeout } from './dsl.ts'
import { collectTrace } from './trace.ts'
import type { CaseTrace } from './trace.ts'
import { isEvalReviewFailure, runEvalReview } from './review.ts'
import type { EvalReviewConfig } from './review.ts'

/** One case's terminal status. */
export type CaseStatus = 'pass' | 'fail' | 'error' | 'cancelled'

/** The second-model review record inside a case result. */
export interface CaseReviewRecord {
  readonly provider: string
  readonly model?: string
  readonly reviewerSessionId?: string
  readonly durationMs: number
  readonly pass?: boolean
  readonly reason?: string
  readonly failure?: string
  readonly error?: string
}

/** The owned result of one executed case (everything the report needs). */
export interface CaseResult {
  readonly id: string
  readonly description?: string
  readonly status: CaseStatus
  readonly provider: string
  readonly model: string
  readonly timeoutMs: number
  readonly durationMs: number
  readonly sessionId?: string
  readonly workspace?: string
  readonly timedOut?: boolean
  readonly cancelled?: boolean
  readonly error?: string
  readonly assertions: readonly AssertionResult[]
  readonly review?: CaseReviewRecord
  readonly trace: CaseTrace
  /** Report-relative path of the owned trace JSON, when written. */
  readonly tracePath?: string
  /** Report-relative path of the replayable session JSONL, when written. */
  readonly sessionLogPath?: string
  /** The case input, truncated for reports. */
  readonly input: string
}

/** Progress notification emitted while a suite runs. */
export interface EvalProgress {
  readonly suite: string
  readonly caseId: string
  readonly index: number
  readonly total: number
  readonly status: CaseStatus
}

/** Everything the engine needs to run one suite. */
export interface EvalRunOptions {
  /** Provider route every case uses. */
  readonly provider: string
  /** CLI-supplied default model (suite/case resolution beats it). */
  readonly cliModel?: string
  /** CLI-supplied tier overrides. */
  readonly cliTiers?: Readonly<Record<string, string>>
  /** CLI-supplied default timeout (suite/case resolution beats it). */
  readonly cliTimeoutMs?: number
  /** Worker pool size (≥ 1). */
  readonly concurrency: number
  /** Run-level cancellation: aborts active cases and stops scheduling. */
  readonly signal: AbortSignal
  /** Directory scratch workspaces are created under. */
  readonly workspaceRoot: string
  /** Suite-file directory, the anchor for relative `case.seedFrom` paths. */
  readonly suiteDir?: string
  /** Keep scratch workspaces after the run (debugging); default false. */
  readonly keepWorkspaces?: boolean
  /** Directory per-case trace artifacts are written under (relative links land in reports). */
  readonly traceDir?: string
  /** Report-relative base for trace links (default `traces`). */
  readonly traceLinkBase?: string
  /** Progress callback, one call per finished case. */
  readonly onProgress?: (progress: EvalProgress) => void
}

/** The owned result of one suite run. */
export interface SuiteReport {
  readonly suite: string
  readonly description?: string
  readonly provider: string
  readonly concurrency: number
  readonly startedAt: number
  readonly finishedAt: number
  readonly durationMs: number
  readonly summary: {
    readonly total: number
    readonly pass: number
    readonly fail: number
    readonly error: number
    readonly cancelled: number
  }
  readonly cases: readonly CaseResult[]
}

/** The engine-facing review configuration, derived from the plugin config. */
export function evalReviewConfig(config: ResolvedConfig): EvalReviewConfig {
  return {
    reviewerProvider: config.reviewerProvider,
    reviewerModel: config.reviewerModel,
    reviewerTimeoutMs: config.reviewerTimeoutMs,
    reviewerTools: config.reviewerTools,
  }
}

/**
 * Resolve every `expect.prompt` baseline into its text: inline `baseline`
 * passes through, and `baselineFrom` is read relative to the suite file (or
 * as an absolute path). A missing/unreadable file fails loudly BEFORE any
 * agent runs — a prompt-regression case whose baseline cannot load is a
 * configuration error, not a silent skip.
 * @param suite - the validated suite.
 * @param suiteDir - the suite-file directory (anchor for relative paths).
 * @returns a case-id → baseline-text map.
 */
export async function resolvePromptBaselines(suite: EvalSuite, suiteDir?: string): Promise<ReadonlyMap<string, string>> {
  const map = new Map<string, string>()
  for (const caze of suite.cases) {
    const prompt = caze.expect.prompt
    if (prompt === undefined) continue
    if (prompt.baseline !== undefined) {
      map.set(caze.id, prompt.baseline)
      continue
    }
    const rel = prompt.baselineFrom
    if (rel !== undefined) {
      const path = isAbsolute(rel) ? rel : resolve(suiteDir ?? process.cwd(), rel)
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (error: unknown) {
        throw new TypeError(`case "${caze.id}": cannot read prompt baselineFrom ${JSON.stringify(rel)}: ${error instanceof Error ? error.message : String(error)}`)
      }
      map.set(caze.id, text)
    }
  }
  return map
}

/** Serialize one session header as the persistence-backend header line. */
export function sessionHeaderLine(header: SessionHeader): Record<string, unknown> {
  return {
    type: 'session',
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    ...(header.cwd !== undefined ? { cwd: header.cwd } : {}),
    ...(header.parentSession !== undefined ? { parentSession: header.parentSession } : {}),
    ...(header.seedLength !== undefined ? { seedLength: header.seedLength } : {}),
    ...(header.origin !== undefined ? { origin: header.origin } : {}),
    delegationDepth: header.delegationDepth ?? 0,
    ...(header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {}),
  }
}

/**
 * Render one case's events as the canonical replayable session JSONL body
 * (header line + packed chunk rows — the exact on-disk vocabulary of the
 * harness session persistence backend). Trailing newline included.
 * @param header - the session header.
 * @param events - the full session log.
 * @returns the artifact text.
 */
export function renderSessionArtifact(header: SessionHeader, events: readonly SessionEvent[]): string {
  const records = [
    JSON.stringify(sessionHeaderLine(header)),
    ...packChunkRuns(events).map(record => JSON.stringify(record)),
  ]
  return `${records.join('\n')}\n`
}

/** Truncate long report strings without cutting surrogate pairs. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) return `${cut.slice(0, -1)}…`
  return `${cut}…`
}

/** A filesystem-safe case id (workspace directory prefix). */
function safeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]/gu, '_')
  return cleaned === '' ? 'case' : cleaned
}

/** Directory names never copied by `case.seedFrom` (heavy or run-local). */
const EXCLUDED_SEED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.pnpm',
  '.eval-reports',
  '.sessions',
  'coverage',
  'lib',
  'dist',
  'out',
])

/**
 * The suite executor. One engine instance per process; the constructor only
 * captures the context and configuration — no side effects until
 * {@link runSuite}.
 */
export class EvalEngine {
  /** Test seam: replace agent creation. Defaults to the real registry factory. */
  createAgent: (
    workspace: string,
    provider: string,
    model: string,
    maxTokens: number | undefined,
    signal: AbortSignal,
  ) => Promise<AgentHandle> = (workspace, provider, model, maxTokens, signal) => this.defaultCreateAgent(workspace, provider, model, maxTokens, signal)

  constructor(
    private readonly ctx: Context,
    private readonly reviewConfig: EvalReviewConfig,
  ) {}

  /** The real creation path (mirrors the official headless runner). */
  private async defaultCreateAgent(
    workspace: string,
    provider: string,
    model: string,
    maxTokens: number | undefined,
    signal: AbortSignal,
  ): Promise<AgentHandle> {
    return this.ctx.agents.create({
      sessionId: SessionId(`eval-${randomUUID()}`),
      meta: { cwd: workspace },
      agentOptions: { provider, model, ...(maxTokens !== undefined ? { maxTokens } : {}) },
      signal,
      setup: (agentCtx) => {
        installModelSelection(agentCtx, { current: { provider, model }, assembled: undefined })
      },
    })
  }

  /**
   * Run one suite. Resolves every case's model and timeout BEFORE starting
   * any agent; a case that resolves neither throws (configuration error,
   * never a silent default).
   * @param suite - the validated suite.
   * @param options - the run options.
   * @returns the owned suite report.
   */
  async runSuite(suite: EvalSuite, options: EvalRunOptions): Promise<SuiteReport> {
    const table: ResolvedModelTable = {
      provider: options.provider,
      ...(options.cliModel !== undefined ? { cliModel: options.cliModel } : {}),
      cliTiers: options.cliTiers ?? {},
    }
    // Upfront validation: model, timeout, and regexes — fail loud, run nothing.
    for (const caze of suite.cases) {
      const model = resolveCaseModel(caze, suite, table)
      if (model === undefined) {
        throw new TypeError(
          `case "${caze.id}" resolves no model: set case.model / case.tier, suite models.default, or pass --model`,
        )
      }
      const timeout = resolveCaseTimeout(caze, suite, options.cliTimeoutMs)
      if (timeout === undefined) {
        throw new TypeError(
          `case "${caze.id}" resolves no timeout: set case.timeoutMs, suite timeoutMs, or pass --timeout-ms`,
        )
      }
      validateExpectations(caze)
    }
    const promptBaselines = await resolvePromptBaselines(suite, options.suiteDir)
    await mkdir(options.workspaceRoot, { recursive: true })
    const startedAt = Date.now()
    const concurrency = Math.max(1, Math.min(options.concurrency, suite.cases.length))
    const results: CaseResult[] = new Array<CaseResult>(suite.cases.length)
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (cursor < suite.cases.length && !options.signal.aborted) {
        const index = cursor
        cursor += 1
        const caze = suite.cases[index] as EvalCase
        const result = await this.runCase(suite, caze, table, options, promptBaselines)
        results[index] = result
        options.onProgress?.({ suite: suite.name, caseId: caze.id, index, total: suite.cases.length, status: result.status })
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    // Cases the abort skipped before scheduling.
    for (let index = 0; index < results.length; index += 1) {
      if (results[index] === undefined) {
        const caze = suite.cases[index] as EvalCase
        results[index] = this.cancelledResult(suite, caze, table, `skipped: the run was cancelled before this case started`)
      }
    }
    const finishedAt = Date.now()
    const cases = results.filter((item): item is CaseResult => item !== undefined)
    const summary = {
      total: cases.length,
      pass: cases.filter(item => item.status === 'pass').length,
      fail: cases.filter(item => item.status === 'fail').length,
      error: cases.filter(item => item.status === 'error').length,
      cancelled: cases.filter(item => item.status === 'cancelled').length,
    }
    return {
      suite: suite.name,
      ...(suite.description !== undefined ? { description: suite.description } : {}),
      provider: options.provider,
      concurrency,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      summary,
      cases,
    }
  }

  /** A cancelled case placeholder. */
  private cancelledResult(suite: EvalSuite, caze: EvalCase, table: ResolvedModelTable, error: string): CaseResult {
    const model = resolveCaseModel(caze, suite, table) ?? '(unresolved)'
    const timeout = resolveCaseTimeout(caze, suite, 0) ?? 0
    return {
      id: caze.id,
      ...(caze.description !== undefined ? { description: caze.description } : {}),
      status: 'cancelled',
      provider: table.provider,
      model,
      timeoutMs: timeout,
      durationMs: 0,
      cancelled: true,
      error,
      assertions: [],
      trace: {
        sessionId: '',
        firstSeq: 0,
        lastSeq: -1,
        toolCalls: [],
        finalOutput: '',
      },
      input: clip(caze.input, 500),
    }
  }

  /** Execute one case end to end. */
  private async runCase(
    suite: EvalSuite,
    caze: EvalCase,
    table: ResolvedModelTable,
    options: EvalRunOptions,
    promptBaselines: ReadonlyMap<string, string>,
  ): Promise<CaseResult> {
    const model = resolveCaseModel(caze, suite, table) as string
    const timeoutMs = resolveCaseTimeout(caze, suite, options.cliTimeoutMs) as number
    if (options.signal.aborted) return this.cancelledResult(suite, caze, table, 'the run was cancelled before this case started')
    const startedAt = Date.now()
    const workspace = await mkdtemp(join(options.workspaceRoot, `${safeId(caze.id)}-`))
    try {
      if (caze.seedFrom !== undefined) {
        const seedRoot = isAbsolute(caze.seedFrom)
          ? caze.seedFrom
          : resolve(options.suiteDir ?? process.cwd(), caze.seedFrom)
        await cp(seedRoot, workspace, {
          recursive: true,
          filter: (source) => {
            const base = source.split(/[\\/]/u).at(-1) ?? ''
            return !EXCLUDED_SEED_NAMES.has(base)
          },
        })
      }
      for (const file of caze.files) {
        await writeFile(join(workspace, file.path), file.content, { flag: 'wx' })
      }
    } catch (error: unknown) {
      return {
        id: caze.id,
        ...(caze.description !== undefined ? { description: caze.description } : {}),
        status: 'error',
        provider: table.provider,
        model,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        workspace,
        error: `cannot seed workspace: ${error instanceof Error ? error.message : String(error)}`,
        assertions: [],
        trace: { sessionId: '', firstSeq: 0, lastSeq: -1, toolCalls: [], finalOutput: '' },
        input: clip(caze.input, 500),
      }
    }
    let handle: AgentHandle | undefined
    try {
      handle = await this.createAgent(workspace, table.provider, model, caze.maxTokens, options.signal)
      const agent = handle.agent
      await agent.whenIdle()
      const firstSeq = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: caze.input }],
        source: { kind: 'user' },
      }))
      const outcome = await this.awaitIdle(agent, timeoutMs, options.signal)
      await this.flushSession(agent)
      const trace = collectTrace(agent.session.id, sessionEvents(agent.session), firstSeq)
      const artifacts = await this.writeTraceArtifacts(options, caze, agent.session.header, sessionEvents(agent.session), trace)
      const assertionResults = runAssertions(caze, trace, promptBaselines)
      let review: CaseReviewRecord | undefined
      if (caze.review !== undefined && !options.signal.aborted) {
        review = await this.runReview(agent, caze, trace, options.signal)
      }
      const timedOut = outcome === 'timeout'
      const cancelled = outcome === 'cancelled' || options.signal.aborted
      let status: CaseStatus
      if (cancelled) {
        status = 'cancelled'
      } else if (review !== undefined && review.failure !== undefined) {
        status = 'error'
      } else if (timedOut || assertionResults.some(item => !item.passed) || review?.pass === false) {
        status = 'fail'
      } else {
        status = 'pass'
      }
      const durationMs = Date.now() - startedAt
      return {
        id: caze.id,
        ...(caze.description !== undefined ? { description: caze.description } : {}),
        status,
        provider: table.provider,
        model,
        timeoutMs,
        durationMs,
        sessionId: agent.session.id as string,
        workspace,
        ...(timedOut ? { timedOut: true } : {}),
        ...(cancelled ? { cancelled: true } : {}),
        ...(outcome === 'timeout'
          ? { error: `case exceeded its ${timeoutMs} ms timeout` }
          : {}),
        assertions: assertionResults,
        ...(review !== undefined ? { review } : {}),
        trace,
        ...(artifacts.tracePath !== undefined ? { tracePath: artifacts.tracePath } : {}),
        ...(artifacts.sessionLogPath !== undefined ? { sessionLogPath: artifacts.sessionLogPath } : {}),
        input: clip(caze.input, 500),
      }
    } catch (error: unknown) {
      return {
        id: caze.id,
        ...(caze.description !== undefined ? { description: caze.description } : {}),
        status: options.signal.aborted ? 'cancelled' : 'error',
        provider: table.provider,
        model,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        ...(handle !== undefined ? { sessionId: handle.agent.session.id as string } : {}),
        workspace,
        ...(options.signal.aborted ? { cancelled: true } : {}),
        error: `case failed: ${error instanceof Error ? error.message : String(error)}`,
        assertions: [],
        trace: { sessionId: '', firstSeq: 0, lastSeq: -1, toolCalls: [], finalOutput: '' },
        input: clip(caze.input, 500),
      }
    } finally {
      if (handle !== undefined) {
        try {
          await handle.dispose()
        } catch (error: unknown) {
          this.ctx.logger?.warn(`dsh-eval: disposing case "${caze.id}" agent failed: ${String(error)}`)
        }
      }
      if (!options.keepWorkspaces) {
        await rm(workspace, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  /** Flush the session's durability backend (the replay artifact), when mounted. */
  private async flushSession(agent: Agent): Promise<void> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return
    try {
      await sessions.flush(agent.session)
    } catch (error: unknown) {
      this.ctx.logger?.warn(`dsh-eval: session flush failed (trace replay artifact may be missing): ${String(error)}`)
    }
  }

  /**
   * Write the per-case trace artifacts under the configured trace directory:
   * an owned trace JSON (the report's machine data) and the canonical
   * replayable session JSONL. Failures are non-fatal (the report still
   * carries the in-memory trace).
   * @returns report-relative paths of the artifacts that were written.
   */
  private async writeTraceArtifacts(
    options: EvalRunOptions,
    caze: EvalCase,
    header: SessionHeader,
    events: readonly SessionEvent[],
    trace: CaseTrace,
  ): Promise<{ tracePath?: string; sessionLogPath?: string }> {
    if (options.traceDir === undefined) return {}
    await mkdir(options.traceDir, { recursive: true })
    const base = safeId(caze.id)
    try {
      await writeFile(join(options.traceDir, `${base}.trace.json`), `${JSON.stringify(trace, undefined, 2)}\n`)
    } catch (error: unknown) {
      this.ctx.logger?.warn(`dsh-eval: cannot write trace JSON for "${caze.id}": ${String(error)}`)
    }
    try {
      await writeFile(join(options.traceDir, `${base}.session.jsonl`), renderSessionArtifact(header, events))
    } catch (error: unknown) {
      this.ctx.logger?.warn(`dsh-eval: cannot write session artifact for "${caze.id}": ${String(error)}`)
    }
    return {
      tracePath: `${options.traceLinkBase ?? 'traces'}/${base}.trace.json`,
      sessionLogPath: `${options.traceLinkBase ?? 'traces'}/${base}.session.jsonl`,
    }
  }

  /**
   * Wait for the agent to reach quiescence, raced against the per-case
   * timeout and the run signal. On timeout the agent is cancelled (the turn
   * records `aborted` and the case fails with `timedOut`); on run abort the
   * caller's dispose path stops the loop.
   * @returns the race outcome.
   */
  private awaitIdle(agent: Agent, timeoutMs: number, signal: AbortSignal): Promise<'idle' | 'timeout' | 'cancelled'> {
    return new Promise((resolve) => {
      let settled = false
      const settle = (value: 'idle' | 'timeout' | 'cancelled'): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onRunAbort)
        resolve(value)
      }
      const timer = setTimeout(() => {
        agent.cancel({ kind: 'hook', reason: `dsh-eval case timeout after ${timeoutMs} ms` })
        settle('timeout')
      }, timeoutMs)
      const onRunAbort = (): void => {
        agent.cancel({ kind: 'hook', reason: 'dsh-eval run cancelled' })
        settle('cancelled')
      }
      signal.addEventListener('abort', onRunAbort, { once: true })
      void agent.whenIdle().then(
        () => settle(signal.aborted ? 'cancelled' : 'idle'),
        () => settle(signal.aborted ? 'cancelled' : 'idle'),
      )
    })
  }

  /** Run the second-model review for one case (the agent is still live). */
  private async runReview(agent: Agent, caze: EvalCase, trace: CaseTrace, signal: AbortSignal): Promise<CaseReviewRecord> {
    const started = Date.now()
    const resolution = await runEvalReview(this.ctx, this.reviewConfig, agent, caze, trace, signal)
    const durationMs = Date.now() - started
    if (isEvalReviewFailure(resolution)) {
      this.ctx.logger?.warn(`dsh-eval: review failed for case "${caze.id}" (${resolution.failure}): ${resolution.error}`)
      return {
        provider: this.reviewConfig.reviewerProvider,
        ...(resolution.model !== undefined ? { model: resolution.model } : {}),
        ...(resolution.reviewerSessionId !== undefined ? { reviewerSessionId: resolution.reviewerSessionId } : {}),
        durationMs,
        failure: resolution.failure,
        error: resolution.error,
      }
    }
    return {
      provider: this.reviewConfig.reviewerProvider,
      ...(caze.review?.model ?? this.reviewConfig.reviewerModel) !== undefined
        ? { model: (caze.review?.model ?? this.reviewConfig.reviewerModel) as string }
        : {},
      durationMs,
      pass: resolution.pass,
      reason: resolution.reason,
    }
  }
}

/**
 * Render a compact one-line summary of one case result (CLI progress,
 * report headers). Pure over owned report data.
 * @param result - the case result.
 * @returns the summary line.
 */
export function summarizeCaseResult(result: CaseResult): string {
  const toolNames = result.trace.toolCalls.map(call => call.name)
  const trace = toolNames.length === 0 ? 'no tools' : `tools: ${toolNames.join(' → ')}`
  const review = result.review === undefined
    ? ''
    : result.review.failure !== undefined
      ? ` · review ${result.review.failure}`
      : ` · review ${result.review.pass === true ? 'pass' : 'fail'}`
  const error = result.error !== undefined ? ` · ${result.error}` : ''
  const failed = result.assertions.filter(item => !item.passed).map(item => item.id).join(',')
  const failedNote = failed === '' ? '' : ` · failed: ${failed}`
  return `${result.status} ${result.id} (${result.durationMs} ms, ${result.model}) ${trace}${review}${failedNote}${error}`
}
