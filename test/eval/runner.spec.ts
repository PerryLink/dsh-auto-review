/**
 * Runner tests: the isolated-session pool over a scripted agent factory —
 * status folding, timeout/cancel behavior, concurrency cap, seed copying,
 * trace artifacts, and the loud no-model/no-timeout contract.
 * @module dsh-auto-review/test/eval/runner
 */

import { mkdtemp, readFile, rm, writeFile, readdir, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { parseSuite } from '../../src/eval/dsl.ts'
import type { EvalSuite } from '../../src/eval/dsl.ts'
import { EvalEngine, resolvePromptBaselines } from '../../src/eval/runner.ts'

const REVIEW_CONFIG = { reviewerProvider: 'mock', reviewerTimeoutMs: 1000, reviewerTools: ['read'] }

/** Scripted fake agent: followup appends scripted events and resolves idle. */
function makeFakeAgent(script: { events: SessionEvent[]; idle?: () => Promise<void>; onCancel?: (reason: string) => void; delayMs?: number }): { handle: AgentHandle; agent: { events: SessionEvent[]; cancelled: string[] } } {
  const events = [...script.events]
  const cancelled: string[] = []
  const session = {
    id: SessionId('eval-test'),
    seq: 5,
    events,
    header: { version: 0, id: SessionId('eval-test'), createdAt: Date.now(), cwd: 'x', delegationDepth: 0 } as SessionHeader,
  } as unknown as Session
  let idleWaiters: (() => void)[] = []
  // A scripted turn is in flight between followup() and the turn's completion.
  let busy = false
  const agent = {
    id: session.id,
    options: {},
    session,
    inbox: {},
    status: 'idle',
    ctx: new Context(),
    whenIdle: () => new Promise<void>(resolve => {
      // Before any followup the agent is idle, like a real fresh agent.
      if (!busy) { resolve(); return }
      if (script.idle !== undefined) { void script.idle().then(resolve, resolve); return }
      idleWaiters.push(resolve)
    }),
    followup: () => {
      busy = true
      setTimeout(() => {
        busy = false
        for (const waiter of idleWaiters.splice(0)) waiter()
      }, script.delayMs ?? 0)
    },
    cancel: (cause: { reason?: string }) => {
      cancelled.push(cause.reason ?? '')
      busy = false
      for (const waiter of idleWaiters.splice(0)) waiter()
    },
    send: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
    runMaintenance: async () => undefined,
  } as unknown as Agent
  return { handle: { agent, dispose: async () => undefined }, agent: { events, cancelled } }
}

function event(seq: number, type: string, data: unknown): SessionEvent {
  return { type, seq, time: seq * 1000, data } as unknown as SessionEvent
}

function completedTraceEvents(output: string, toolName?: string): SessionEvent[] {
  const events = [event(6, 'turn/start', { turn: 1 })]
  if (toolName !== undefined) {
    events.push(event(7, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: toolName, arguments: '{"pattern":"src/**"}' }))
    events.push(event(8, 'tool/result', { turn: 1, step: 1, message: { role: 'user', id: 'm1', source: { kind: 'tool', toolName }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'src/index.ts' }] }] } }))
  }
  events.push(event(9, 'assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: output }] } }))
  events.push(event(10, 'turn/end', { turn: 1, reason: { kind: 'completed' } }))
  return events
}

const PASS_SUITE = parseSuite(`
name: r
cases:
  - id: a
    input: "1"
    expect:
      toolCalls:
        - tool: glob
      output:
        contains: "found"
`) as EvalSuite

const FAIL_SUITE = parseSuite(`
name: r
cases:
  - id: a
    input: "1"
    expect:
      toolCalls:
        - tool: write
`) as EvalSuite

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function runWith(
  suite: EvalSuite,
  createAgent: EvalEngine['createAgent'],
  extra: Partial<ConstructorParameters<typeof EvalEngine>[1] & { concurrency?: number; signal?: AbortSignal; keepWorkspaces?: boolean; traceDir?: string; cliTimeoutMs?: number; cliModel?: string }> = {},
): Promise<Awaited<ReturnType<EvalEngine['runSuite']>>> {
  const ctx = new Context()
  const engine = new EvalEngine(ctx, { ...REVIEW_CONFIG, ...extra })
  engine.createAgent = createAgent
  const root = await mkdtemp(join(tmpdir(), 'dsh-eval-runner-'))
  dirs.push(root)
  return engine.runSuite(suite, {
    provider: 'deepseek-official',
    concurrency: extra.concurrency ?? 1,
    signal: extra.signal ?? new AbortController().signal,
    workspaceRoot: root,
    ...(extra.keepWorkspaces !== undefined ? { keepWorkspaces: extra.keepWorkspaces } : {}),
    ...(extra.traceDir !== undefined ? { traceDir: extra.traceDir } : {}),
    ...(extra.cliTimeoutMs !== undefined ? { cliTimeoutMs: extra.cliTimeoutMs } : { cliTimeoutMs: 1000 }),
    ...(extra.cliModel !== undefined ? { cliModel: extra.cliModel } : { cliModel: 'test-model' }),
  })
}

describe('EvalEngine.runSuite', () => {
  it('passes a satisfied case, cleans its workspace, and writes artifacts', async () => {
    let seenWorkspace: string | undefined
    let disposed = false
    const traceRoot = await mkdtemp(join(tmpdir(), 'dsh-eval-traces-'))
    dirs.push(traceRoot)
    const report = await runWith(PASS_SUITE, async (workspace) => {
      seenWorkspace = workspace
      const { handle } = makeFakeAgent({ events: completedTraceEvents('found it', 'glob') })
      return { agent: handle.agent, dispose: async () => { disposed = true } }
    }, { traceDir: join(traceRoot, 'traces') })
    expect(report.summary).toEqual({ total: 1, pass: 1, fail: 0, error: 0, cancelled: 0 })
    expect(report.cases[0]?.status).toBe('pass')
    expect(report.cases[0]?.tracePath).toBe('traces/a.trace.json')
    expect(disposed).toBe(true)
    expect(existsSync(seenWorkspace as string)).toBe(false)
  })

  it('writes trace and replay artifacts into the trace directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-eval-artifacts-'))
    dirs.push(root)
    const traceDir = join(root, 'traces')
    const report = await runWith(PASS_SUITE, async () => {
      const { handle } = makeFakeAgent({ events: completedTraceEvents('found it', 'glob') })
      return handle
    }, { traceDir })
    const caze = report.cases[0] as { tracePath?: string; sessionLogPath?: string }
    expect(caze.tracePath).toBe('traces/a.trace.json')
    expect(caze.sessionLogPath).toBe('traces/a.session.jsonl')
    const artifact = await readFile(join(traceDir, 'a.session.jsonl'), 'utf8')
    expect(artifact).toContain('"type":"session"')
    expect(artifact).toContain('tool/call')
  })

  it('fails a case whose assertions do not hold', async () => {
    const report = await runWith(FAIL_SUITE, async () => {
      const { handle } = makeFakeAgent({ events: completedTraceEvents('done', 'read') })
      return handle
    })
    expect(report.cases[0]?.status).toBe('fail')
    const assertion = report.cases[0]?.assertions.find(item => item.id === 'toolCalls[0]')
    expect(assertion?.passed).toBe(false)
  })

  it('times out a stuck agent: cancel + timedOut fail status', async () => {
    let cancelled: string[] = []
    const report = await runWith(FAIL_SUITE, async () => {
      const made = makeFakeAgent({ events: completedTraceEvents('done', 'read'), idle: () => new Promise<void>(() => undefined) })
      cancelled = made.agent.cancelled
      return made.handle
    }, { cliTimeoutMs: 25 })
    expect(report.cases[0]?.status).toBe('fail')
    expect(report.cases[0]?.timedOut).toBe(true)
    expect(cancelled.some(reason => reason.includes('timeout'))).toBe(true)
  })

  it('marks a pre-aborted run cancelled without starting agents', async () => {
    let started = 0
    const controller = new AbortController()
    controller.abort()
    const report = await runWith(PASS_SUITE, async () => {
      started += 1
      return makeFakeAgent({ events: completedTraceEvents('x') }).handle
    }, { signal: controller.signal })
    expect(started).toBe(0)
    expect(report.cases[0]?.status).toBe('cancelled')
  })

  it('caps concurrency at the configured worker count', async () => {
    const suite = parseSuite(`
name: c
concurrency: 2
cases:
  - {id: "1", input: "a"}
  - {id: "2", input: "b"}
  - {id: "3", input: "c"}
`) as EvalSuite
    let active = 0
    let peak = 0
    const report = await runWith(suite, async () => {
      active += 1
      peak = Math.max(peak, active)
      const made = makeFakeAgent({ events: completedTraceEvents('x'), delayMs: 40 })
      return {
        agent: made.handle.agent,
        dispose: async () => { active -= 1 },
      }
    }, { concurrency: 2 })
    expect(peak).toBe(2)
    expect(report.summary.total).toBe(3)
    expect(report.summary.pass).toBe(3)
  })

  it('throws before running anything when a model or timeout resolves from nothing', async () => {
    const suite = parseSuite('name: m\ncases:\n  - {id: a, input: "1"}\n') as EvalSuite
    const ctx = new Context()
    const engine = new EvalEngine(ctx, REVIEW_CONFIG)
    engine.createAgent = async () => { throw new Error('must not run') }
    const root = await mkdtemp(join(tmpdir(), 'dsh-eval-runner-'))
    dirs.push(root)
    const options = {
      provider: 'deepseek-official',
      concurrency: 1,
      signal: new AbortController().signal,
      workspaceRoot: root,
    }
    await expect(engine.runSuite(suite, options)).rejects.toThrow(/no model/u)
    await expect(engine.runSuite(suite, { ...options, cliModel: 'm1' })).rejects.toThrow(/no timeout/u)
  })

  it('seeds the workspace from seedFrom (excluding heavy directories) and cleans up', async () => {
    const seed = await mkdtemp(join(tmpdir(), 'dsh-eval-seed-'))
    dirs.push(seed)
    await writeFile(join(seed, 'keep.txt'), 'kept')
    await mkdir(join(seed, 'node_modules'), { recursive: true })
    await writeFile(join(seed, 'node_modules', 'junk.js'), 'junk')
    const suite = parseSuite(`
name: s
cases:
  - id: a
    input: "1"
    seedFrom: ${JSON.stringify(seed)}
`) as EvalSuite
    let seenWorkspace: string | undefined
    const report = await runWith(suite, async (workspace) => {
      seenWorkspace = workspace
      return makeFakeAgent({ events: completedTraceEvents('x') }).handle
    }, { keepWorkspaces: true })
    expect(report.cases[0]?.status).toBe('pass')
    const entries = await readdir(seenWorkspace as string)
    expect(entries).toContain('keep.txt')
    expect(entries).not.toContain('node_modules')
  })

  it('keeps the workspace with keepWorkspaces', async () => {
    let seenWorkspace: string | undefined
    const report = await runWith(PASS_SUITE, async (workspace) => {
      seenWorkspace = workspace
      return makeFakeAgent({ events: completedTraceEvents('found it', 'glob') }).handle
    }, { keepWorkspaces: true })
    expect(report.cases[0]?.status).toBe('pass')
    expect(existsSync(seenWorkspace as string)).toBe(true)
  })
})

describe('resolvePromptBaselines', () => {
  it('passes inline baselines through and reads baselineFrom files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-eval-baseline-'))
    dirs.push(root)
    await writeFile(join(root, 'base.txt'), 'You are a helpful software engineer assistant.')
    const suite = parseSuite(`
name: s
cases:
  - id: inline
    input: "1"
    expect:
      prompt: {baseline: "inline baseline"}
  - id: fromFile
    input: "2"
    expect:
      prompt: {baselineFrom: "base.txt"}
`) as EvalSuite
    const map = await resolvePromptBaselines(suite, root)
    expect(map.get('inline')).toBe('inline baseline')
    expect(map.get('fromFile')).toBe('You are a helpful software engineer assistant.')
  })

  it('fails loud on a missing baselineFrom file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-eval-baseline-'))
    dirs.push(root)
    const suite = parseSuite('name: s\ncases:\n  - id: a\n    input: "1"\n    expect:\n      prompt: {baselineFrom: "nope.txt"}\n') as EvalSuite
    await expect(resolvePromptBaselines(suite, root)).rejects.toThrow(/cannot read prompt baselineFrom/u)
  })
})
