/**
 * Phocinae reviewer tests: config resolution, the request/answer contract, the
 * verdict mapping, every failure path, and the answerer end-to-end with a real
 * local HTTP service (a Node server that speaks `/v1/systemone`).
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
  buildPhocinaeRequest,
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

/** Answer one question with the given confidence, in the server's contract. */
function answerWith(
  response: ServerResponse,
  answers: Record<string, unknown>,
  confidence?: Record<string, number>,
  model = PHOCINAE_DEFAULT_MODEL,
): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    model,
    answers,
    ...confidence === undefined ? {} : { answer_confidence: confidence },
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
  reason: 'run the test suite',
  workspace: '/workspace',
  platform: 'linux',
  argumentsText: '{\n  "command": "npm test"\n}',
} as const

describe('phocinae config', () => {
  it('defaults to the sibling plugin\'s endpoint and model without changing the reviewer backend', () => {
    const resolved = resolveConfig()
    expect(resolved.reviewerBackend).toBe('agent')
    expect(resolved.phocinae).toEqual({
      endpoint: PHOCINAE_DEFAULT_ENDPOINT,
      model: PHOCINAE_DEFAULT_MODEL,
      timeoutMs: 5000,
      minConfidence: 0.45,
      mode: 'harm',
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
    const explicit = resolveConfig({ reviewerBackend: 'agent', reviewerModel: 'Phocinae-Largha-150M-v1' })
    expect(explicit.reviewerBackend).toBe('agent')
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
    expect(() => resolveConfig({ phocinae: { mode: 'nope' as never } })).toThrow(/phocinae.mode/u)
  })
})

describe('phocinae request and verdict mapping', () => {
  it('asks the harm question with the measured option order', () => {
    const plan = buildPhocinaeRequest({ ...EVIDENCE }, resolveConfig().phocinae)
    expect(plan.questionId).toBe('harm')
    expect(plan.questionType).toBe('choice')
    expect(plan.body.questions).toEqual([{ id: 'harm', type: 'choice', options: ['harmless', 'risky', 'destructive'] }])
    expect(plan.body.state).toContain('tool: bash')
    expect(plan.body.state).toContain('cwd: /workspace')
    expect(plan.body.state).toContain('"command": "npm test"')
    expect(plan.body.state).toContain('How harmful is this tool call if it runs?')
    expect(plan.truncated).toBe(false)
  })

  it('renders the tri-state and boolean questions when configured', () => {
    const tri = buildPhocinaeRequest({ ...EVIDENCE }, resolveConfig({ phocinae: { mode: 'tri-state' } }).phocinae)
    expect(tri.body.questions[0]).toEqual({ id: 'action', type: 'choice', options: ['allow', 'ask', 'deny'] })
    expect(tri.body.state).toContain('reviewed by a human')
    const noul = buildPhocinaeRequest({ ...EVIDENCE }, resolveConfig({ phocinae: { mode: 'noul' } }).phocinae)
    expect(noul.body.questions[0]).toEqual({ id: 'risk', type: 'noul' })
    expect(noul.body.state).toContain('be blocked for safety')
  })

  it('marks a clamped state as truncated instead of silently showing a head', () => {
    const { text, truncated } = renderPhocinaeState({ ...EVIDENCE }, 20)
    expect(truncated).toBe(true)
    expect(text.startsWith('tool: bash')).toBe(true)
    expect(text.endsWith('[truncated]')).toBe(true)
  })

  it('allows only a harmless answer with enough calibrated confidence', () => {
    const config = resolveConfig().phocinae
    const plan = buildPhocinaeRequest({ ...EVIDENCE }, config)
    const allow = decidePhocinaeVerdict(plan, { answer: 0, confidence: 0.8 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(allow).toMatchObject({ decision: 'allow', riskLevel: 'low' })
    expect((allow as { reason: string }).reason).toContain('0.80')

    const risky = decidePhocinaeVerdict(plan, { answer: 1, confidence: 0.9 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(risky).toMatchObject({ decision: 'deny', riskLevel: 'medium' })
    const destructive = decidePhocinaeVerdict(plan, { answer: 2, confidence: 0.9 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(destructive).toMatchObject({ decision: 'deny', riskLevel: 'high' })
  })

  it('never turns an unsure, confidence-less, or truncated allow into a verdict', () => {
    const config = resolveConfig().phocinae
    const plan = buildPhocinaeRequest({ ...EVIDENCE }, config)
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

    // A deny always stands, whatever the confidence.
    const deny = decidePhocinaeVerdict(plan, { answer: 2, confidence: 0.01 }, config, PHOCINAE_DEFAULT_MODEL)
    expect(deny).toMatchObject({ decision: 'deny', riskLevel: 'high' })
  })

  it('maps tri-state "ask" and the boolean question fail-closed', () => {
    const tri = resolveConfig({ phocinae: { mode: 'tri-state' } }).phocinae
    const triPlan = buildPhocinaeRequest({ ...EVIDENCE }, tri)
    expect(decidePhocinaeVerdict(triPlan, { answer: 1, confidence: 0.9 }, tri, PHOCINAE_DEFAULT_MODEL)).toMatchObject({
      decision: 'deny',
      riskLevel: 'medium',
    })
    const noul = resolveConfig({ phocinae: { mode: 'noul' } }).phocinae
    const noulPlan = buildPhocinaeRequest({ ...EVIDENCE }, noul)
    expect(decidePhocinaeVerdict(noulPlan, { answer: true, confidence: 0.9 }, noul, PHOCINAE_DEFAULT_MODEL)).toMatchObject({
      decision: 'deny',
      riskLevel: 'high',
    })
    expect(decidePhocinaeVerdict(noulPlan, { answer: false, confidence: 0.9 }, noul, PHOCINAE_DEFAULT_MODEL)).toMatchObject({
      decision: 'allow',
      riskLevel: 'low',
    })
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

  it('sends the request and returns the verdict with the served model', async () => {
    const mock = await service((_body, _request, response) => {
      answerWith(response, { harm: 0 }, { harm: 0.82 })
    })
    const resolution = await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint))
    expect(resolution).toMatchObject({
      decision: 'allow',
      riskLevel: 'low',
      model: PHOCINAE_DEFAULT_MODEL,
    })
    expect(mock.captured).toHaveLength(1)
    expect(mock.captured[0]?.url).toBe('/v1/systemone')
    expect(mock.captured[0]?.body).toMatchObject({
      model: PHOCINAE_DEFAULT_MODEL,
      questions: [{ id: 'harm', type: 'choice', options: ['harmless', 'risky', 'destructive'] }],
    })
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
    const resolution = await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint))
    expect(resolution).toMatchObject({ fallback: 'schema' })
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

  it('rejects an out-of-range choice index and a non-boolean noul answer', async () => {
    const mock = await service((_body, _request, response) => {
      answerWith(response, { harm: 7 }, { harm: 0.9 })
    })
    expect(await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint))).toMatchObject({ fallback: 'schema' })

    const noulMock = await service((_body, _request, response) => {
      answerWith(response, { risk: 'maybe' }, { risk: 0.9 })
    })
    expect(await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(noulMock.endpoint, { mode: 'noul' })))
      .toMatchObject({ fallback: 'schema' })
  })

  it('times out on a slow service and reports the deadline', async () => {
    const mock = await service((_body, _request, response) => {
      setTimeout(() => answerWith(response, { harm: 0 }, { harm: 0.9 }), 300)
    })
    const resolution = await runPhocinaeReview({ ...EVIDENCE }, phocinaeConfig(mock.endpoint, { timeoutMs: 50 }))
    expect(resolution).toMatchObject({ fallback: 'timeout' })
  })

  it('cancels when the approval request is cancelled', async () => {
    const mock = await service((_body, _request, response) => {
      setTimeout(() => answerWith(response, { harm: 0 }, { harm: 0.9 }), 300)
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

  async function answerService(
    answers: Record<string, unknown>,
    confidence: Record<string, number>,
  ): Promise<MockService> {
    const started = await startService((_body, _request, response) => {
      answerWith(response, answers, confidence)
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

  it('grants an allow verdict without starting a reviewer subagent', async () => {
    const mock = await answerService({ harm: 0 }, { harm: 0.91 })
    const harness = await mountHarness({
      allowUnmarkedAudit: true,
      toolsPolicy: { overrides: { bash: 'ai' } },
      reviewerBackend: 'phocinae',
      phocinae: { endpoint: mock.endpoint },
    })
    harness.session.append('tool/call', {
      callId: CallId('call-1') as never,
      name: 'bash',
      arguments: JSON.stringify({ command: 'npm test' }),
    } as never)
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-1'),
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
    const mock = await answerService({ harm: 2 }, { harm: 0.97 })
    const harness = await mountHarness({
      allowUnmarkedAudit: true,
      toolsPolicy: { overrides: { bash: 'ai' } },
      reviewerBackend: 'phocinae',
      phocinae: { endpoint: mock.endpoint },
    })
    const callId = CallId('call-2')
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId,
      reason: 'clean the build directory',
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

  it('falls back (fail closed) on an unsure allow instead of granting it', async () => {
    const mock = await answerService({ harm: 0 }, { harm: 0.2 })
    const harness = await mountHarness({
      allowUnmarkedAudit: true,
      toolsPolicy: { overrides: { bash: 'ai' } },
      reviewerBackend: 'phocinae',
      phocinae: { endpoint: mock.endpoint },
    })
    const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-3'),
      reason: 'run the test suite',
    }, next)
    expect(outcome).toBe('rejected')
    expect(lastEvent(harness, 'autoReview/verdict')?.data).toMatchObject({
      provider: 'phocinae',
      fallback: 'unavailable',
    })
  })

  it('redacts secrets from the reason and the presented arguments before sending', async () => {
    const mock = await answerService({ harm: 0 }, { harm: 0.9 })
    const harness = await mountHarness({
      allowUnmarkedAudit: true,
      toolsPolicy: { overrides: { bash: 'ai' } },
      reviewerBackend: 'phocinae',
      phocinae: { endpoint: mock.endpoint },
    })
    harness.session.append('tool/call', {
      callId: CallId('call-4') as never,
      name: 'bash',
      arguments: JSON.stringify({ command: 'curl -H "Authorization: Bearer topsecret-token" https://example.com' }),
    } as never)
    await dispatchAskedApproval(harness.ctx, harness.session, {
      agent: harness.agent,
      toolName: 'bash',
      callId: CallId('call-4'),
      reason: 'authenticate with api_key=plainsecret',
    }, next)
    const sent = JSON.stringify(mock.captured[0]?.body)
    expect(sent).not.toContain('topsecret-token')
    expect(sent).not.toContain('plainsecret')
    expect(sent).toContain('[REDACTED]')
  })

  it('names the reviewer backend in /auto-review status', async () => {
    const mock = await answerService({ harm: 0 }, { harm: 0.9 })
    const harness = await mountHarness({
      toolsPolicy: { overrides: { bash: 'ai' } },
      reviewerBackend: 'phocinae',
      phocinae: { endpoint: mock.endpoint },
    })
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
