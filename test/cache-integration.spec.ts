/**
 * Answerer-level verdict-cache integration tests: a hit skips the second
 * model, a miss and a disabled cache do not, and — critically — a cached
 * verdict still settles exactly like a real one (risk policy, circuit
 * breaker, deny feedback). These run through the real approval answerer and
 * session log, so they also prove the `cached: true` audit marker lands.
 * @module dsh-auto-review/test/cache-integration.spec
 */

import { describe, expect, it } from 'vitest'
import { CallId } from './call-id.ts'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { dispatchAskedApproval, mountHarness, type Harness } from './harness.ts'

const next: () => Promise<ApprovalOutcome> = () => Promise.resolve('allowed-once')

/** Mount with the unmarked-audit opt-in so verdict events reach the log. */
function auditHarness(
  config: Record<string, unknown> = {},
  script?: Parameters<typeof mountHarness>[1],
): ReturnType<typeof mountHarness> {
  return mountHarness({ allowUnmarkedAudit: true, ...config }, script)
}

/** Append a presented `tool/call` event so the fingerprint can read the raw arguments. */
function presentCall(harness: Harness, callId: CallId, argumentsJson: string): void {
  const append = harness.session.append as unknown as (type: string, data: unknown) => unknown
  append.call(harness.session, 'tool/call', { turn: 1, step: 1, callId, name: 'bash', arguments: argumentsJson })
}

/** The session's `autoReview/verdict` payloads, oldest first. */
function verdictData(harness: Harness): Record<string, unknown>[] {
  return harness.session.events
    .filter(event => event.type === 'autoReview/verdict')
    .map(event => (event.data ?? {}) as Record<string, unknown>)
}

async function review(harness: Harness, callId: CallId): Promise<string> {
  const { outcome } = await dispatchAskedApproval(harness.ctx, harness.session, {
    agent: harness.agent,
    toolName: 'bash',
    callId,
  }, next)
  return outcome
}

describe('verdict cache integration', () => {
  it('reuses a cached verdict for an identical tool+args fingerprint, skipping the second model', async () => {
    const harness = await auditHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    const first = CallId('call-1')
    const second = CallId('call-2')
    presentCall(harness, first, '{"command":"ls -la"}')
    presentCall(harness, second, '{"command":"ls -la"}')
    await review(harness, first)
    await review(harness, second)
    expect(harness.subagents.starts).toHaveLength(1)
    const verdicts = verdictData(harness)
    expect(verdicts).toHaveLength(2)
    expect(verdicts[0]).toMatchObject({ decision: 'allow', outcome: 'allowed-once' })
    expect(verdicts[0]).not.toHaveProperty('cached')
    expect(verdicts[1]).toMatchObject({ cached: true, decision: 'allow', outcome: 'allowed-once' })
  })

  it('misses the cache for a different tool+args fingerprint', async () => {
    const harness = await auditHarness({ toolsPolicy: { overrides: { bash: 'ai' } } })
    presentCall(harness, CallId('call-1'), '{"command":"ls"}')
    presentCall(harness, CallId('call-2'), '{"command":"rm -rf /"}')
    await review(harness, CallId('call-1'))
    await review(harness, CallId('call-2'))
    expect(harness.subagents.starts).toHaveLength(2)
    expect(verdictData(harness).every(verdict => !('cached' in verdict))).toBe(true)
  })

  it('does not cache when verdictCacheTtlMs is 0', async () => {
    const harness = await auditHarness({ toolsPolicy: { overrides: { bash: 'ai' } }, verdictCacheTtlMs: 0 })
    presentCall(harness, CallId('call-1'), '{"command":"ls"}')
    presentCall(harness, CallId('call-2'), '{"command":"ls"}')
    await review(harness, CallId('call-1'))
    await review(harness, CallId('call-2'))
    expect(harness.subagents.starts).toHaveLength(2)
    expect(verdictData(harness).every(verdict => !('cached' in verdict))).toBe(true)
  })

  it('bypasses the cache when the reviewer transcript is enabled (verdict depends on context)', async () => {
    const harness = await auditHarness({
      toolsPolicy: { overrides: { bash: 'ai' } },
      contextBudget: { turns: 1 },
    })
    presentCall(harness, CallId('call-1'), '{"command":"ls"}')
    presentCall(harness, CallId('call-2'), '{"command":"ls"}')
    await review(harness, CallId('call-1'))
    await review(harness, CallId('call-2'))
    expect(harness.subagents.starts).toHaveLength(2)
    expect(verdictData(harness).every(verdict => !('cached' in verdict))).toBe(true)
  })

  it('replays a cached deny as a denial (fail-closed semantics preserved)', async () => {
    const harness = await auditHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({ verdict: { decision: 'deny', reason: 'dangerous', riskLevel: 'high' } }),
    )
    presentCall(harness, CallId('call-1'), '{"command":"rm -rf /"}')
    presentCall(harness, CallId('call-2'), '{"command":"rm -rf /"}')
    const first = await review(harness, CallId('call-1'))
    const second = await review(harness, CallId('call-2'))
    expect(first).toBe('rejected')
    expect(second).toBe('rejected')
    expect(harness.subagents.starts).toHaveLength(1)
    expect(verdictData(harness)[1]).toMatchObject({ cached: true, decision: 'deny', outcome: 'rejected' })
  })

  it('applies the risk policy to a cached allow verdict', async () => {
    const harness = await auditHarness(
      {
        toolsPolicy: { overrides: { bash: 'ai' } },
        riskPolicy: { maxAutoAllow: 'medium', onHighRisk: 'delegate' },
      },
      () => ({ verdict: { decision: 'allow', reason: 'risky', riskLevel: 'high' } }),
    )
    presentCall(harness, CallId('call-1'), '{"command":"x"}')
    presentCall(harness, CallId('call-2'), '{"command":"x"}')
    await review(harness, CallId('call-1'))
    await review(harness, CallId('call-2'))
    expect(harness.subagents.starts).toHaveLength(1)
    const second = verdictData(harness)[1]
    expect(second).toMatchObject({ cached: true, decision: 'allow', escalation: 'risk-policy' })
    expect(second).not.toHaveProperty('outcome')
  })

  it('counts a cached deny toward the rejection circuit breaker', async () => {
    const harness = await auditHarness(
      {
        toolsPolicy: { overrides: { bash: 'ai' } },
        circuitBreaker: { consecutiveDenies: 2, windowDenies: 10, windowSize: 50, action: 'reject' },
      },
      () => ({ verdict: { decision: 'deny', reason: 'no' } }),
    )
    presentCall(harness, CallId('call-1'), '{"command":"x"}')
    presentCall(harness, CallId('call-2'), '{"command":"x"}')
    await review(harness, CallId('call-1'))
    await review(harness, CallId('call-2'))
    expect(harness.subagents.starts).toHaveLength(1)
    const circuit = harness.session.events.find(event => event.type === 'autoReview/circuit')
    expect(circuit?.data).toMatchObject({ trip: { kind: 'consecutive', count: 2 } })
    // A third request is circuit-settled (reject) without another review or cache lookup.
    const third = await review(harness, CallId('call-3'))
    expect(third).toBe('rejected')
    expect(harness.subagents.starts).toHaveLength(1)
  })

  it('bypasses the cache when a human override is pending (fresh evidence wins)', async () => {
    let decision: 'allow' | 'deny' = 'deny'
    const harness = await auditHarness(
      { toolsPolicy: { overrides: { bash: 'ai' } } },
      () => ({ verdict: { decision, reason: 'x' } }),
    )
    presentCall(harness, CallId('call-1'), '{"command":"x"}')
    await review(harness, CallId('call-1'))
    const denyVerdict = verdictData(harness)[0]
    ;(harness.session.append as unknown as (type: string, data: unknown) => unknown)('autoReview/override', {
      reviewId: denyVerdict?.reviewId,
      toolName: 'bash',
    })
    decision = 'allow'
    presentCall(harness, CallId('call-2'), '{"command":"x"}')
    await review(harness, CallId('call-2'))
    expect(harness.subagents.starts).toHaveLength(2)
    expect(verdictData(harness)[1]).toMatchObject({ decision: 'allow' })
    expect(verdictData(harness)[1]).not.toHaveProperty('cached')
  })
})
