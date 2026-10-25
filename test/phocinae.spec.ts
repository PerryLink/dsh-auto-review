/**
 * Phocinae reviewer tests: config resolution, command extraction, the measured
 * request shape, the verdict mapping, every failure path, and the answerer
 * end-to-end with a real local HTTP service (a Node server that speaks
 * `/v1/systemone`).
 * @module dsh-auto-review/test/phocinae.spec
 */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { CallId } from './call-id.ts'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import {
  PHOCINAE_DEFAULT_ENDPOINT,
  PHOCINAE_DEFAULT_MODEL,
  isPhocinaeModelName,
  resolveConfig,
  resolvePhocinaeConfig,
} from '../src/index.ts'
import {
  PHOCINAE_HARM_OPTIONS,
  buildPhocinaeRequest,
  commandOfArguments,
  decidePhocinaeVerdict,
  isPhocinaeFailure,
  renderPhocinaeState,
  runPhocinaeReview,
} from '../src/phocinae.ts'
import { dispatchAskedApproval, dispatchPostExecute, mountHarness } from './harness.ts'

const next: () => Promise<ApprovalOutcome> = () => Promise.resolve('allowed-once')

/** One captured request the mock service received. */
interface CapturedRequest {
  readonly url: string
  readonly body: Record<string, unknown>
}

/** A running mock of the Phocinae decision service. */
interface MockService {
  readonly endpoint: string
  readonly captured: CapturedRequest[]
  close(): Promise<void>
}

/** Read a whole request body as text. */
async function bodyText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Start a mock `/v1/systemone` service on a random loopback port.
 * @param respond - handler receiving the captured body; it owns the response.
 * @returns the endpoint, the captured requests, and a close function.
 */
async function startService(
  respond: (body: Record<string, unknown>, request: IncomingMessage, response: ServerResponse) => void,
): Promise<MockService> {
  const captured: CapturedRequest[] = []
  const server = createServer((request, response) => {
    void bodyText(request).then(text => {
      const body = JSON.parse(text) as Record<string, unknown>
      captured.push({ url: request.url ?? '', body })
      respond(body, request, response)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    endpoint: `http://127.0.0.1:${port}/v1/systemone`,
    captured,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

/** Answer the harm question with the given index and confidence. */
function answerWith(
  response: ServerResponse,
  answer: number,
  confidence?: number,
  model = PHOCINAE_DEFAULT_MODEL,
): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    model,
    answers: { harm: answer },
    ...confidence === undefined ? {} : { answer_confidence: { harm: confidence } },
  }))
}

/** A config that talks to `endpoint`; `reviewerTimeoutMs` bounds the HTTP deadline too. */
function phocinaeConfig(endpoint: string, extra: Record<string, unknown> = {}) {
  return resolveConfig({
    reviewerBackend: 'phocinae',
    reviewerTimeoutMs: 2000,
    phocinae: { endpoint, timeoutMs: 1000, ...extra },
  })
}

/** The evidence one review sends for a bash command. */
const EVIDENCE = {
  toolName: 'bash',
  argumentsText: '{\n  "command": "npm test"\n}',
} as const

describe('phocinae config', () => {
  it('defaults to the sibling plugin endpoint and model without changing the reviewer backend', () => {
    const resolved = resolveConfig()
    expect(resolved.reviewerBackend).toBe('agent')
    expect(resolved.phocinae).toEqual({
      endpoint: PHOCINAE_DEFAULT_ENDPOINT,
      model: PHOCINAE_DEFAULT_MODEL,
      timeoutMs: 5000,
      minConfidence: 0.4,
      maxStateChars: 4096,
      allowRemoteEndpoint: false,
    })
  })

  it('infers the phocinae backend from a Phocinae reviewer model name', () => {
    expect(isPhocinaeModelName('Phocinae-Largha-150M-v1')).toBe(true)
    expect(isPhocinaeModelName('phocinae')).toBe(true)
    expect(isPhocinaeModelName('phocinae:local')).toBe(true)
    expect(isPhocinaeModelName('deepseek-flash')).toBe(false)
    expect(isPhocinaeModelName(undefined)).toBe(false)

    const inferred = resolveConfig({ reviewerModel: 'Phocinae-Largha-150M-v1' })
    expect(inferred.reviewerBackend).toBe('phocinae')
    expect(inferred.phocinae.model).toBe('Phocinae-Largha-150M-v1')
  })

  it('lets an explicit backend win over the model-name inference', () => {
    expect(resolveConfig({ reviewerBackend: 'agent', reviewerModel: 'Phocinae-Largha-150M-v1' }).reviewerBackend)
      .toBe('agent')
  })

  it('keeps the published model when only the backend is set', () => {
    expect(resolveConfig({ reviewerBackend: 'phocinae' }).phocinae.model).toBe(PHOCINAE_DEFAULT_MODEL)
  })

  it('refuses a non-loopback endpoint unless the egress is explicit', () => {
    expect(() => resolvePhocinaeConfig({ endpoint: 'http://10.1.2.3:8155/v1/systemone' }))
      .toThrow(/not loopback/u)
    const allowed = resolvePhocinaeConfig({
      endpoint: 'http://10.1.2.3:8155/v1/systemone',
      allowRemoteEndpoint: true,
    })
    expect(allowed.endpoint).toBe('http://10.1.2.3:8155/v1/systemone')
    expect(() => resolvePhocinaeConfig({ endpoint: 'file:///tmp/socket' })).toThrow(/http or https/u)
    expect(() => resolvePhocinaeConfig({ endpoint: 'not a url' })).toThrow(/absolute URL/u)
  })

  it('rejects out-of-range settings loudly', () => {
    expect(() => resolvePhocinaeConfig({ minConfidence: 1.5 })).toThrow(/minConfidence/u)
    expect(() => resolvePhocinaeConfig({ timeoutMs: 0 })).toThrow(/timeoutMs/u)
    expect(() => resolvePhocinaeConfig({ maxStateChars: -1 })).toThrow(/maxStateChars/u)
    expect(() => resolvePhocinaeConfig({ model: '   ' })).toThrow(/model/u)
    expect(() => resolveConfig({ reviewerBackend: 'nope' as never })).toThrow(/reviewerBackend/u)
  })
})

describe('phocinae command extraction', () => {
  it('reads the shell command spellings the harness uses', () => {
    expect(commandOfArguments('{"command":"ls -la"}')).toBe('ls -la')
    expect(commandOfArguments('{"cmd":"pwd"}')).toBe('pwd')
    expect(commandOfArguments('{"script":"npm test"}')).toBe('npm test')
    expect(commandOfArguments('{"CommandLine":"Get-Date"}')).toBe('Get-Date')
    expect(commandOfArguments('"echo hi"')).toBe('echo hi')
  })

  it('returns undefined for a non-shell call instead of guessing', () => {
    expect(commandOfArguments('{"path":"README.md"}')).toBeUndefined()
    expect(commandOfArguments('{"command":"   "}')).toBeUndefined()
    expect(commandOfArguments('not json')).toBeUndefined()
    expect(commandOfArguments(undefined)).toBeUndefined()
  })
})

describe('phocinae request and verdict mapping', () => {
  it('asks the measured question: a plain statement and described options', () => {
    const plan = buildPhocinaeRequest('npm test', resolveConfig().phocinae)
    expect(plan.questionId).toBe('harm')
    expect(plan.questionType).toBe('choice')
    expect(plan.body.state).toBe('The agent is about to run the shell command "npm test" in its workspace.')
    expect(plan.body.questions).toEqual([{ id: 'harm', type: 'choice', options: PHOCINAE_HARM_OPTIONS }])
    expect(PHOCINAE_HARM_OPTIONS).toHaveLength(3)
    expect(PHOCINAE_HARM_OPTIONS[0]).toMatch(/^harmless: /u)
    expect(PHOCINAE_HARM_OPTIONS[1]).toMatch(/^risky: /u)
    expect(PHOCINAE_HARM_OPTIONS[2]).toMatch(/^destructive: /u)
    expect(plan.truncated).toBe(false)
  })

  it('marks a clamped state as truncated instead of silently showing a head', () => {
    const { text, truncated } = renderPhocinaeState('x'.repeat(100), 20)
    expect(truncated).toBe(true)
    expect(text.endsWith('[truncated]')).toBe(true)
  })

  it('allows only a harmless answer with enough calibrated confidence', () => {
    const config = resolveConfig().phocinae
    const plan = buildPhocinaeRequest('npm test', config)
    const allow = decidePhocinaeVerdict(plan, { answer: 0, confidence: 0.8 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(allow).toMatchObject({ decision: 'allow', riskLevel: 'low' })
    expect((allow as { reason: string }).reason).toContain('0.80')

    // Risky escalates; it is never a grant and never a hard deny.
    const risky = decidePhocinaeVerdict(plan, { answer: 1, confidence: 0.9 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(isPhocinaeFailure(risky)).toBe(true)
    expect((risky as { error: string }).error).toContain('risky')

    const destructive = decidePhocinaeVerdict(plan, { answer: 2, confidence: 0.1 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(destructive).toMatchObject({ decision: 'deny', riskLevel: 'high' })
  })

  it('never turns an unsure, confidence-less, or truncated allow into a verdict', () => {
    const config = resolveConfig().phocinae
    const plan = buildPhocinaeRequest('npm test', config)
    const unsure = decidePhocinaeVerdict(plan, { answer: 0, confidence: 0.3 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(isPhocinaeFailure(unsure)).toBe(true)
    expect((unsure as { error: string }).error).toContain('minConfidence')

    const missing = decidePhocinaeVerdict(plan, { answer: 0, confidence: undefined }, config, PHOCINAE_DEFAULT_MODEL)
    expect(isPhocinaeFailure(missing)).toBe(true)
    expect((missing as { error: string }).error).toContain('calibrated confidence')

    const truncatedPlan = { ...plan, truncated: true }
    const truncated = decidePhocinaeVerdict(truncatedPlan, { answer: 0, confidence: 0.99 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(isPhocinaeFailure(truncated)).toBe(true)
    expect((truncated as { error: string }).error).toContain('truncated')

    // A truncated state can still deny: a denial does not rest on full evidence.
    const truncatedDeny = decidePhocinaeVerdict(truncatedPlan, { answer: 2, confidence: 0.2 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(truncatedDeny).toMatchObject({ decision: 'deny', riskLevel: 'high' })
  })
})

describe('phocinae transport', () => {
  const services: MockService[] = []
  afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()))
  })

  /** Start and track a service so `afterEach` always closes the port. */
  async function service(
    respond: (body: Record<string, unknown>, request: IncomingMessage, response: ServerResponse) => void,
  ): Promise<MockService> {
    const started = await startService(respond)
    services.push(started)
    return started
  }

  it('sends the measured request and returns the verdict with the served model', async () => {
    const mock = await service((_body, _request, response) => {
      answerWith(response, 0, 0.82)
    })
    const resolution = await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint))
    expect(resolution).toMatchObject({ decision: 'allow', riskLevel: 'low', model: PHOCINAE_DEFAULT_MODEL })
    expect(mock.captured).toHaveLength(1)
    expect(mock.captured[0]?.url).toBe('/v1/systemone')
    expect(mock.captured[0]?.body).toEqual({
      model: PHOCINAE_DEFAULT_MODEL,
      state: 'The agent is about to run the shell command "npm test" in its workspace.',
      questions: [{ id: 'harm', type: 'choice', options: [...PHOCINAE_HARM_OPTIONS] }],
    })
  })

  it('escalates a non-shell tool without contacting the service', async () => {
    const mock = await service((_body, _request, response) => {
      answerWith(response, 0, 0.99)
    })
    const resolution = await runPhocinaeReview(
      { toolName: 'write', argumentsText: '{"path":"a.txt"}' },
      phocinaeConfig(mock.endpoint),
    )
    expect(resolution).toMatchObject({ fallback: 'unavailable' })
    expect((resolution as { error: string }).error).toContain('shell commands only')
    expect(mock.captured).toHaveLength(0)
  })

  it('fails closed on an HTTP error', async () => {
    const mock = await service((_body, _request, response) => {
      response.writeHead(500, { 'content-type': 'text/plain' })
      response.end('model not loaded')
    })
    const resolution = await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint))
    expect(resolution).toMatchObject({ fallback: 'unavailable' })
    expect((resolution as { error: string }).error).toContain('HTTP 500')
  })

  it('fails closed when the body is not JSON', async () => {
    const mock = await service((_body, _request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('not json')
    })
    expect(await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint))).toMatchObject({ fallback: 'schema' })
  })

  it('treats an answers ARRAY as a protocol error rather than an empty answer', async () => {
    const mock = await service((_body, _request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ model: PHOCINAE_DEFAULT_MODEL, answers: [0] }))
    })
    const resolution = await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint))
    expect(resolution).toMatchObject({ fallback: 'schema' })
    expect((resolution as { error: string }).error).toContain('array')
  })

  it('rejects an out-of-range choice index', async () => {
    const mock = await service((_body, _request, response) => {
      answerWith(response, 7, 0.9)
    })
    expect(await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint))).toMatchObject({ fallback: 'schema' })
  })

  it('times out on a slow service and reports the deadline', async () => {
    const mock = await service((_body, _request, response) => {
      setTimeout(() => answerWith(response, 0, 0.9), 300)
    })
    const resolution = await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint, { timeoutMs: 50 }))
    expect(resolution).toMatchObject({ fallback: 'timeout' })
  })

  it('cancels when the approval request is cancelled', async () => {
    const mock = await service((_body, _request, response) => {
      setTimeout(() => answerWith(response, 0, 0.9), 300)
    })
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 20)
    const resolution = await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint), controller.signal)
    expect(resolution).toMatchObject({ fallback: 'cancelled' })
  })

  it('reports an unreachable service without throwing', async () => {
    const resolution = await runPhocinaeReview(
      { ...EVIDENCE },
      phocinaeConfig('http://127.0.0.1:1/v1/systemone', { timeoutMs: 200 }),
    )
    expect(resolution).toMatchObject({ fallback: 'unavailable' })
    expect((resolution as { error: string }).error).toContain('unreachable')
  })
})

describe('phocinae answerer integration', () => {
  const services: MockService[] = []
  afterEach(async () => {
    await Promise.all(services.splice(0).map(service => service.close()))
  })

  async function answerService(answer: number, confidence: number): Promise<MockService> {
    const started = await startService((_body, _request, response) => {
      answerWith(response, answer, confidence)
    })
    services.push(started)
    return started
  }

  /** The last event of one type in the session log. */
  function lastEvent(harness: Awaited<ReturnType<typeof mountHarness>>, type: string) {
    for (const event of [...harness.session.snapshotEvents()].reverse()) {
      if (event.type === type) return event
    }
    return undefined
  }

  /** Mount the plugin against a mock service with `bash: ai`. */
  async function mount(endpoint: string, config: Record<string, unknown> = {}) {
    return mountHarness({
      allowUnmarkedAudit: true,
      toolsPolicy: { overrides: { bash: 'ai' } },
      reviewerBackend: 'phocinae',
      phocinae: { endpoint },
      ...config,
    })
  }

  /** Append the presented call the evidence builder reads. */
  function appendCall(harness: Awaited<ReturnType<typeof mountHarness>>, callId: CallId, command: string) {
    harness.session.append('tool/call', {
      callId: callId as never,
      name: 'bash',
      arguments: JSON.stringify({ command }),
    } as never)
  }

  it('grants a harmless verdict without starting a reviewer subagent', async () => {
    const mock = await answerService(0, 0.91)
    const harness = await mount(mock.endpoint)
    const callId = CallId('call-1')
    appendCall(harness, callId, 'npm test')
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
      reason: 'run the test suite',
    }, next)
    expect(outcome).toBe('allowed-once')
    expect(harness.subagents.starts).toHaveLength(0)
    expect(lastEvent(harness, 'autoReview/verdict')?.data).toMatchObject({
      provider: 'phocinae',
      model: PHOCINAE_DEFAULT_MODEL,
      decision: 'allow',
      riskLevel: 'low',
      outcome: 'allowed-once',
    })
  })

  it('denies a destructive verdict and feeds the reason back', async () => {
    const mock = await answerService(2, 0.97)
    const harness = await mount(mock.endpoint)
    const callId = CallId('call-2')
    appendCall(harness, callId, 'rm -rf /')
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
      reason: 'clean the root directory',
    }, next)
    expect(outcome).toBe('rejected')
    expect(lastEvent(harness, 'autoReview/verdict')?.data).toMatchObject({
      provider: 'phocinae',
      decision: 'deny',
      riskLevel: 'high',
    })
    const decision = await dispatchPostExecute(harness.ctx, { callId } as never, {
      isError: true,
      content: [{ type: 'text', text: 'Error: rejected' }],
    }, async () => ({ kind: 'accept' }))
    const feedback = (decision as { feedback: { text: string }[] }).feedback
    expect(feedback[0]!.text).toContain('phocinae')
    expect(feedback[0]!.text).toContain('Do not attempt')
  })

  it('escalates a risky verdict through the fallback policy', async () => {
    const mock = await answerService(1, 0.9)
    const harness = await mount(mock.endpoint)
    const callId = CallId('call-3')
    appendCall(harness, callId, 'rm -rf ./build')
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
      reason: 'clean the build output',
    }, next)
    expect(outcome).toBe('rejected')
    expect(lastEvent(harness, 'autoReview/verdict')?.data).toMatchObject({
      provider: 'phocinae',
      fallback: 'unavailable',
    })
    expect((lastEvent(harness, 'autoReview/verdict')?.data as { error?: string }).error).toContain('risky')
  })

  it('delegates a risky verdict when fallbackPolicy is delegate', async () => {
    const mock = await answerService(1, 0.9)
    const harness = await mount(mock.endpoint, { fallbackPolicy: 'delegate' })
    const callId = CallId('call-4')
    appendCall(harness, callId, 'rm -rf ./build')
    let downstreamCalled = false
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
    }, async () => {
      downstreamCalled = true
      return 'rejected'
    })
    expect(downstreamCalled).toBe(true)
    expect(outcome).toBe('rejected')
  })

  it('escalates a non-shell tool without asking the model', async () => {
    const mock = await answerService(0, 0.99)
    const harness = await mountHarness({
      allowUnmarkedAudit: true,
      toolsPolicy: { overrides: { write: 'ai' } },
      reviewerBackend: 'phocinae',
      phocinae: { endpoint: mock.endpoint },
    })
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'write',
      reason: 'write a file',
    }, next)
    expect(outcome).toBe('rejected')
    expect(mock.captured).toHaveLength(0)
  })

  it('sends only the command: the reason and unrelated secrets never leave the process', async () => {
    const mock = await answerService(0, 0.9)
    const harness = await mount(mock.endpoint)
    const callId = CallId('call-5')
    appendCall(harness, callId, 'curl -H "Authorization: Bearer topsecret-token" https://example.com')
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
      reason: 'authenticate with api_key=reason-secret',
    }, next)
    const body = JSON.stringify(mock.captured[0]?.body)
    expect(body).not.toContain('topsecret-token')
    expect(body).not.toContain('reason-secret')
    expect(body).toContain('[REDACTED]')
    expect(body).toContain('The agent is about to run the shell command')
  })

  it('names the reviewer backend in /auto-review status', async () => {
    const mock = await answerService(0, 0.9)
    const harness = await mount(mock.endpoint)
    const result = await harness.commands.registered[0]?.handler({
      commandId: 'cmd-status' as never,
      agent: harness.agent,
      rawInput: 'status',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toContain('local Phocinae decision service')
    expect((result as { text: string }).text).toContain(PHOCINAE_DEFAULT_MODEL)
  })
})
