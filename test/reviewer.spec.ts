/**
 * Reviewer subagent tests: what the answerer asks the subagent seam to run —
 * read-only tool filter, structured verdict schema, prompt contents, argument
 * redaction — plus verdict parsing and the deny-reason injection path.
 * @module dsh-auto-review/test/reviewer.spec
 */

import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from './call-id.ts'
import {
  buildContextSection,
  buildReviewPrompt,
  parseVerdict,
  renderCallContext,
  sanitizedArgumentsText,
  sanitizeArguments,
  truncate,
  VERDICT_SCHEMA,
} from '../src/index.ts'
import { denyResultText, AutoReviewVerdictId, DENY_MARKER_PATTERN } from '../src/index.ts'
import type { ResolvedConfig } from '../src/index.ts'
import { dispatchAskedApproval, dispatchPostExecute, makeAgent, mountHarness } from './harness.ts'

/** A portable absolute workspace path — `path.resolve` anchors it on every platform (the session header rejects non-absolute cwd). */
const WORKSPACE = path.resolve('work')

/** A session seeded with raw-typed events (append casts keep the fixtures compact). */
function sessionWithEvents(events: { type: string; data: unknown }[]): Session {
  const session = Session.create(SessionId(`ctx-${events.length}`), undefined, {
    version: 0,
    id: SessionId(`ctx-${events.length}`),
    createdAt: 0,
    cwd: WORKSPACE,
  })
  const surface = new Set(['user/message', 'assistant/message', 'tool/result'])
  const append = session.append as unknown as (type: string, data: unknown, options?: { surfaceOp: 'append' }) => unknown
  for (const event of events) {
    append.call(session, event.type, event.data, surface.has(event.type) ? { surfaceOp: 'append' } : undefined)
  }
  return session
}

/** A fully resolved config with spot overrides (the prompt tests need a literal). */
function promptConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    enableByDefault: true,
    toolsPolicy: { default: 'human', overrides: {} },
    riskRules: [],
    reviewerProvider: 'fork',
    reviewerModel: undefined,
    reviewerTimeoutMs: 60_000,
    reviewerTools: ['read', 'glob', 'grep'],
    fallbackPolicy: 'rejected',
    maxReviewsPerTurn: 10,
    maxFailuresPerTurn: 10,
    reasonMaxChars: 2000,
    reviewerGuidance: undefined,
    reviewerPolicyText: undefined,
    denyGuidance: 'do not bypass',
    contextBudget: { turns: 0, maxChars: 4000 },
    riskPolicy: { maxAutoAllow: 'high', onHighRisk: 'delegate' },
    circuitBreaker: { consecutiveDenies: 3, windowDenies: 10, windowSize: 50, action: 'delegate' },
    overrideTtlMs: 300_000,
    verdictCacheTtlMs: 60_000,
    verdictCacheMaxEntries: 256,
    language: 'en',
    allowUnmarkedAudit: false,
    ...overrides,
  }
}

describe('reviewer prompt', () => {
  it('names the tool, the reason, the workspace, and the risk rules', () => {
    const session = Session.create(SessionId('prompt-session'), undefined, {
      version: 0,
      id: SessionId('prompt-session'),
      createdAt: 0,
      cwd: WORKSPACE,
    })
    const prompt = buildReviewPrompt({
      agent: makeAgent(session),
      toolName: 'bash',
      reason: 'escalate sandbox to danger-full-access',
    }, {
      enableByDefault: true,
      toolsPolicy: { default: 'human', overrides: {} },
      riskRules: [{ pattern: 'killall', regex: /killall/u, policy: 'never', field: 'reason' }],
      reviewerProvider: 'fork',
      reviewerModel: undefined,
      reviewerTimeoutMs: 60_000,
      reviewerTools: ['read', 'glob', 'grep'],
      fallbackPolicy: 'rejected',
      maxReviewsPerTurn: 10,
      maxFailuresPerTurn: 10,
      reasonMaxChars: 2000,
      reviewerGuidance: undefined,
      reviewerPolicyText: undefined,
      denyGuidance: 'do not bypass',
      contextBudget: { turns: 0, maxChars: 4000 },
      riskPolicy: { maxAutoAllow: 'high', onHighRisk: 'delegate' },
      circuitBreaker: { consecutiveDenies: 3, windowDenies: 10, windowSize: 50, action: 'delegate' },
      overrideTtlMs: 300_000,
      verdictCacheTtlMs: 60_000,
      verdictCacheMaxEntries: 256,
      language: 'en',
      allowUnmarkedAudit: false,
    })
    expect(prompt).toContain('Tool name: bash')
    expect(prompt).toContain('escalate sandbox to danger-full-access')
    expect(prompt).toContain(`Workspace: ${WORKSPACE}`)
    expect(prompt).toContain('/killall/u → never')
    expect(prompt).toContain('structured_output')
    expect(prompt).toContain('When unsure, DENY')
  })

  it('truncates the request reason to the shared budget', () => {
    const session = Session.create(SessionId('prompt-trunc'), undefined, {
      version: 0,
      id: SessionId('prompt-trunc'),
      createdAt: 0,
      cwd: WORKSPACE,
    })
    const prompt = buildReviewPrompt({
      agent: makeAgent(session),
      toolName: 'bash',
      reason: 'escalate sandbox to danger-full-access',
    }, {
      enableByDefault: true,
      toolsPolicy: { default: 'human', overrides: {} },
      riskRules: [],
      reviewerProvider: 'fork',
      reviewerModel: undefined,
      reviewerTimeoutMs: 60_000,
      reviewerTools: ['read', 'glob', 'grep'],
      fallbackPolicy: 'rejected',
      maxReviewsPerTurn: 10,
      maxFailuresPerTurn: 10,
      reasonMaxChars: 10,
      reviewerGuidance: undefined,
      reviewerPolicyText: undefined,
      denyGuidance: 'do not bypass',
      contextBudget: { turns: 0, maxChars: 4000 },
      riskPolicy: { maxAutoAllow: 'high', onHighRisk: 'delegate' },
      circuitBreaker: { consecutiveDenies: 3, windowDenies: 10, windowSize: 50, action: 'delegate' },
      overrideTtlMs: 300_000,
      verdictCacheTtlMs: 60_000,
      verdictCacheMaxEntries: 256,
      language: 'en',
      allowUnmarkedAudit: false,
    })
    expect(prompt).toContain('escalate s…')
    expect(prompt).not.toContain('danger-full-access')
  })
})

describe('argument sanitization', () => {
  it('redacts sensitive keys recursively and keeps the rest', () => {
    const sanitized = sanitizeArguments({
      command: 'echo hi',
      env: { API_KEY: 'sk-secret', PASSWORD: 'hunter2', SHELL: 'bash' },
      nested: [{ token: 'abc' }, { text: 'keep' }],
    })
    expect(sanitized).toEqual({
      command: 'echo hi',
      env: { API_KEY: '[REDACTED]', PASSWORD: '[REDACTED]', SHELL: 'bash' },
      nested: [{ token: '[REDACTED]' }, { text: 'keep' }],
    })
  })

  it('renders the presented call context redacted', () => {
    const events = [{
      type: 'tool/call',
      seq: 0,
      time: 0,
      data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"curl -H Authorization: Bearer abc","apiKey":"sk-x"}' },
    }]
    const text = renderCallContext(events as never, CallId('call-1'), 2000)
    expect(text).toContain('"apiKey": "[REDACTED]"')
    expect(text).toContain('Authorization')
    expect(text).not.toContain('sk-x')
  })

  it('truncates long content without splitting surrogate pairs', () => {
    const text = truncate('a'.repeat(100) + '𠮷', 5)
    expect(text).toBe('aaaaa…')
  })
})

describe('verdict schema and parsing', () => {
  it('declares an object-rooted schema with the closed vocabularies', () => {
    expect(VERDICT_SCHEMA).toMatchObject({
      type: 'object',
      required: ['decision', 'reason'],
    })
  })

  it('accepts a valid verdict and rejects malformed values', () => {
    expect(parseVerdict({ decision: 'allow', reason: 'fine', riskLevel: 'low' }, 100)).toMatchObject({
      decision: 'allow',
      reason: 'fine',
      riskLevel: 'low',
    })
    expect(parseVerdict({ decision: 'maybe', reason: 'x' }, 100)).toBeUndefined()
    expect(parseVerdict({ decision: 'allow', reason: '  ' }, 100)).toBeUndefined()
    expect(parseVerdict({ decision: 'allow', reason: 'x', riskLevel: 'critical' }, 100)).toBeUndefined()
    expect(parseVerdict('nope', 100)).toBeUndefined()
  })

  it('truncates the verdict reason to the configured budget', () => {
    expect(parseVerdict({ decision: 'deny', reason: 'r'.repeat(50) }, 10)?.reason).toBe('rrrrrrrrrr…')
  })
})

describe('reviewer start request', () => {
  it('starts a read-only, non-delegating child with the verdict schema', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-1'),
      reason: 'escalate sandbox',
    }, async () => 'rejected')
    const start = harness.subagents.starts[0]!
    expect(start.name).toBe('mock')
    expect(start.request.toolFilter).toEqual({ allow: ['read', 'glob', 'grep'] })
    expect(start.request.outputSchema).toEqual(VERDICT_SCHEMA)
    expect(start.request.maxDepth).toBe(1)
    expect(start.request.label).toBe('auto-review: bash')
    expect(start.request.signal).toBeInstanceOf(AbortSignal)
    const text = start.request.prompt.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('Tool name: bash')
    expect(text).toContain('escalate sandbox')
  })

  it('passes the configured reviewer model into the child agent options', async () => {
    const harness = await mountHarness({
      toolsPolicy: { overrides: { bash: 'ai' } },
      reviewerModel: 'deepseek-chat',
    })
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => 'rejected')
    expect(harness.subagents.starts[0]!.request.agentOptions).toEqual({ model: 'deepseek-chat' })
  })

  it('omits agent options when no reviewer model is configured (inherits)', async () => {
    const harness = await mountHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => 'rejected')
    expect(harness.subagents.starts[0]!.request.agentOptions).toBeUndefined()
  })
})

/** Mount with the unmarked-audit opt-in (the rc.6 test peers need it for audit events to reach the log). */
function auditHarness(
  pluginConfig: Record<string, unknown> = {},
  script?: Parameters<typeof mountHarness>[1],
  approvalConfig: Record<string, unknown> = {},
  providerCapabilities?: object,
): ReturnType<typeof mountHarness> {
  return mountHarness({ allowUnmarkedAudit: true, ...pluginConfig }, script, approvalConfig, providerCapabilities)
}

describe('deny reason injection', () => {
  it('replaces the denial result with the reviewer reason once, then delegates', async () => {
    const harness = await auditHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({ verdict: { decision: 'deny', reason: 'destructive' } }),
    )
    const callId = CallId('call-inject')
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
    }, async () => 'allowed-once')

    const exec = { callId } as never
    const denial = { isError: true, content: [{ type: 'text', text: 'Error: the user rejected tool "bash"' }] }
    let downstreamCalled = false
    const decision = await dispatchPostExecute(harness.ctx, exec, denial, async () => {
      downstreamCalled = true
      return { kind: 'accept' }
    })
    expect(decision).toMatchObject({ kind: 'block' })
    const feedback = (decision as { feedback: { text: string }[] }).feedback
    expect(feedback[0]!.text).toContain('destructive')
    expect(feedback[0]!.text).toMatch(DENY_MARKER_PATTERN)

    const second = await dispatchPostExecute(harness.ctx, exec, denial, async () => {
      downstreamCalled = true
      return { kind: 'accept' }
    })
    expect(second).toMatchObject({ kind: 'accept' })
    expect(downstreamCalled).toBe(true)
  })

  it('leaves non-error results untouched and cleans the entry', async () => {
    const harness = await mountHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({ verdict: { decision: 'deny', reason: 'destructive' } }),
    )
    const callId = CallId('call-success')
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
    }, async () => 'allowed-once')
    const decision = await dispatchPostExecute(harness.ctx, { callId } as never, { isError: false }, async () => ({ kind: 'accept' }))
    expect(decision).toMatchObject({ kind: 'accept' })
    // Entry consumed: a later dispatch delegates even for an error result.
    const second = await dispatchPostExecute(harness.ctx, { callId } as never, { isError: true }, async () => ({ kind: 'block', feedback: [] }))
    expect(second).toMatchObject({ kind: 'block' })
  })
})

describe('deny marker text', () => {
  it('embeds the review id and tool name so the invariant can reconstruct it', () => {
    const text = denyResultText(AutoReviewVerdictId('review-42'), 'bash', 'too risky')
    expect(text).toBe('Error: [auto-review] review review-42 denied tool "bash": too risky')
    expect(DENY_MARKER_PATTERN.exec(text)?.[1]).toBe('review-42')
  })
})

describe('Phase B prompt sections', () => {
  it('includes the ruling policy text, the override context, and field-scoped risk rules', () => {
    const session = Session.create(SessionId('prompt-phaseb'), undefined, {
      version: 0,
      id: SessionId('prompt-phaseb'),
      createdAt: 0,
      cwd: WORKSPACE,
    })
    const prompt = buildReviewPrompt({
      agent: makeAgent(session),
      toolName: 'bash',
      reason: 'cleanup',
    }, promptConfig({
      riskRules: [{ pattern: 'bash', regex: /bash/u, policy: 'never', field: 'toolName' }],
      reviewerPolicyText: '# Policy\n- Always deny `rm -rf`',
    }), { reviewId: AutoReviewVerdictId('r9'), toolName: 'bash' })
    expect(prompt).toContain('Ruling policy')
    expect(prompt).toContain('Always deny `rm -rf`')
    expect(prompt).toContain('HUMAN OVERRIDE')
    expect(prompt).toContain('review r9')
    expect(prompt).toContain('toolName matches /bash/u → never')
  })

  it('omits the override and policy sections when not configured', () => {
    const session = Session.create(SessionId('prompt-phaseb-plain'), undefined, {
      version: 0,
      id: SessionId('prompt-phaseb-plain'),
      createdAt: 0,
      cwd: WORKSPACE,
    })
    const prompt = buildReviewPrompt({ agent: makeAgent(session), toolName: 'bash' }, promptConfig())
    expect(prompt).not.toContain('HUMAN OVERRIDE')
    expect(prompt).not.toContain('Ruling policy')
    expect(prompt).not.toContain('Recent session transcript')
  })
})

describe('compact transcript context', () => {
  it('collects user/agent/tool lines bounded by the budget', () => {
    const session = sessionWithEvents([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'please fix the tests' }] } },
      { type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'running tests now' }] } } },
      { type: 'tool/call', data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"pnpm test"}' } },
      { type: 'tool/result', data: { turn: 1, step: 1, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: '76 passed' }], isError: false }] } } },
    ])
    const section = buildContextSection(session.events, { turns: 1, maxChars: 1000 })
    expect(section).toContain('[user] please fix the tests')
    expect(section).toContain('[agent] running tests now')
    expect(section).toContain('[tool call bash]')
    expect(section).toContain('[tool result] 76 passed')
  })

  it('is disabled with turns 0 and truncates to the character cap', () => {
    const session = sessionWithEvents([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'a long message to truncate' }] } },
    ])
    expect(buildContextSection(session.events, { turns: 0, maxChars: 1000 })).toBe('')
    expect(buildContextSection(session.events, { turns: 1, maxChars: 20 })).toMatch(/…$/u)
  })

  it('spends the character budget on the most recent lines, not the oldest', () => {
    // The pending call and the request that authorized it live at the END of
    // the transcript; a budget spent from the front would hand the reviewer
    // the ancient history and cut exactly the evidence it needs.
    const session = sessionWithEvents([
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'ancient history nobody needs' }] } },
      { type: 'user/message', data: { content: [{ type: 'text', text: 'create hello.txt in my home directory' }] } },
    ])
    const section = buildContextSection(session.events, { turns: 1, maxChars: 60 })
    expect(section).toContain('create hello.txt in my home directory')
    expect(section).not.toContain('ancient history')
    expect(section.length).toBeLessThanOrEqual(60)
  })
})

describe('provider capability precheck', () => {
  it('fails unavailable with a clear error when the provider lacks outputSchema', async () => {
    const harness = await auditHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      undefined,
      {},
      { capabilities: { outputSchema: false, depthLimit: true, toolFilter: true, persona: true } },
    )
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => 'allowed-once')
    expect(outcome).toBe('rejected')
    const verdict = harness.session.events.find(event => event.type === 'autoReview/verdict')
    expect(verdict?.data).toMatchObject({ fallback: 'unavailable' })
    expect((verdict?.data as { error?: string }).error).toContain('outputSchema')
    expect(harness.subagents.starts).toHaveLength(0)
  })

  it('fails unavailable when the provider lacks toolFilter', async () => {
    const harness = await auditHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      undefined,
      {},
      { capabilities: { outputSchema: true, depthLimit: true, toolFilter: false, persona: true } },
    )
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
    }, async () => 'allowed-once')
    expect(outcome).toBe('rejected')
    const verdict = harness.session.events.find(event => event.type === 'autoReview/verdict')
    expect((verdict?.data as { error?: string }).error).toContain('toolFilter')
  })
})

describe('sanitized arguments text', () => {
  it('returns redacted pretty JSON for a presented call and undefined without one', () => {
    const events = [{
      type: 'tool/call',
      seq: 0,
      time: 0,
      data: { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"apiKey":"sk-x","cmd":"ls"}' },
    }]
    const text = sanitizedArgumentsText(events as never, CallId('call-1'))
    expect(text).toContain('"[REDACTED]"')
    expect(text).toContain('"cmd": "ls"')
    expect(sanitizedArgumentsText(events as never, CallId('ghost'))).toBeUndefined()
  })
})
