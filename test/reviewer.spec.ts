/**
 * Reviewer subagent tests: what the answerer asks the subagent seam to run —
 * read-only tool filter, structured verdict schema, prompt contents, argument
 * redaction — plus verdict parsing and the deny-reason injection path.
 * @module dsh-auto-review/test/reviewer.spec
 */

import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CallId } from '@deepseek-ai/dsh-llm'
import {
  buildReviewPrompt,
  parseVerdict,
  renderCallContext,
  sanitizeArguments,
  truncate,
  VERDICT_SCHEMA,
} from '../src/index.ts'
import { denyResultText, AutoReviewVerdictId, DENY_MARKER_PATTERN } from '../src/index.ts'
import { dispatchAskedApproval, dispatchPostExecute, makeAgent, mountHarness } from './harness.ts'

describe('reviewer prompt', () => {
  it('names the tool, the reason, the workspace, and the risk rules', () => {
    const session = Session.create(SessionId('prompt-session'), undefined, {
      version: 0,
      id: SessionId('prompt-session'),
      createdAt: 0,
      cwd: 'D:\\work',
    })
    const prompt = buildReviewPrompt({
      agent: makeAgent(session),
      toolName: 'bash',
      reason: 'escalate sandbox to danger-full-access',
    }, {
      enableByDefault: true,
      toolsPolicy: { default: 'human', overrides: {} },
      riskRules: [{ pattern: 'killall', regex: /killall/u, policy: 'never' }],
      reviewerProvider: 'fork',
      reviewerModel: undefined,
      reviewerTimeoutMs: 60_000,
      reviewerTools: ['read', 'glob', 'grep'],
      fallbackPolicy: 'rejected',
      maxReviewsPerTurn: 10,
      maxFailuresPerTurn: 10,
      reasonMaxChars: 2000,
      reviewerGuidance: undefined,
    })
    expect(prompt).toContain('Tool name: bash')
    expect(prompt).toContain('escalate sandbox to danger-full-access')
    expect(prompt).toContain('Workspace: D:\\work')
    expect(prompt).toContain('/killall/u → never')
    expect(prompt).toContain('structured_output')
    expect(prompt).toContain('When unsure, DENY')
  })

  it('truncates the request reason to the shared budget', () => {
    const session = Session.create(SessionId('prompt-trunc'), undefined, {
      version: 0,
      id: SessionId('prompt-trunc'),
      createdAt: 0,
      cwd: 'D:\\work',
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

describe('deny reason injection', () => {
  it('replaces the denial result with the reviewer reason once, then delegates', async () => {
    const harness = await mountHarness(
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
