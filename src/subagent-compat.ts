/**
 * One view of the `ctx.subagents` seam across every host line this plugin
 * declares.
 *
 * Two start shapes exist and neither declaration admits the other:
 *
 * - `dsh <= 0.2.1-alpha` exposes `start(provider, request)` with a per-child
 *   `toolFilter` allow-list and a structured-output schema;
 * - `dsh 0.2.1+` replaced it with `startActivation(spec)`, whose composition
 *   moved to an Agent Preset (no `toolFilter`). The activation spec itself was
 *   reshaped again inside the 0.2.2 line: `0.2.2-rc.1` nests the task under
 *   `request`, while `0.2.2-rc.3` extends `SubagentStartRequest` and puts the
 *   same fields directly on the spec. A nested-only spec is silently unactable
 *   on rc.3 (`prompt` reads as undefined), so {@link buildReviewerActivationSpec}
 *   sends both: the flat fields plus the same composition under `request`.
 *
 * The seam is consumed structurally so one module compiles against every
 * published line; the single `as unknown as` in {@link reviewerSubagentSeam}
 * is the only type escape, and every caller goes through it.
 * @module dsh-auto-review/subagent-compat
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subagent'

/** Host-Agent overrides forwarded to a reviewer child (model route and effort). */
export interface ReviewerAgentOptions {
  /** Child model id; omitted inherits the parent's route. */
  readonly model?: string
  /** Child LLM provider route; omitted inherits the parent's provider. */
  readonly provider?: string
  /** Adapter-owned reasoning effort id; omitted uses the route's default. */
  readonly reasoningEffort?: string
}

/** The task/composition half of an activation, wherever a host line stores it. */
export interface ReviewerActivationComposition {
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /** The spawning agent: seeds a forked child and supplies its default cwd. */
  readonly parent: Agent
  /** Structured output the child must satisfy. */
  readonly outputSchema: ObjectJsonSchema
  /** Absolute delegation-depth cap for the child. */
  readonly maxDepth: number
  /** Read-only Agent Preset the child is composed from. */
  readonly agentPreset: string
  /** Host-Agent overrides for the child. */
  readonly agentOptions?: ReviewerAgentOptions
}

/**
 * One activation spec that satisfies the nested `0.2.2-rc.1` shape and the
 * flattened `0.2.2-rc.3` shape at once.
 */
export interface ReviewerActivationSpec extends ReviewerActivationComposition {
  /** Registered subagent backend to run the child on. */
  readonly provider: string
  /** Short task label retained in cataloged child membership. */
  readonly label: string
  /** The `0.2.2-rc.1` alias: the same composition nested under `request`. */
  readonly request: ReviewerActivationComposition
  /** Caller cancellation, forwarded to the host's activation. */
  readonly signal: AbortSignal
  /** Result delivery policy: the review consumes the result itself. */
  readonly delivery: 'caller'
}

/** The settled result both start shapes resolve to. */
export interface ReviewerRunResult {
  /** Terminal stop reason (`completed` for a delivered verdict). */
  readonly stopReason: string
  /** Provider-validated structured capture, if the child produced one. */
  readonly structured?: unknown
}

/** A running reviewer child, on either seam. */
export interface ReviewerRun {
  /** Settles with the child's terminal result. */
  readonly result: Promise<ReviewerRunResult>
  /** Stop the run and release its resources. */
  dispose(): Promise<void>
}

/** A legacy one-shot run: the run handle plus the child's published session id. */
export interface ReviewerLegacyRun extends ReviewerRun {
  /** The child's durable session id, published by `start`. */
  readonly id: SessionId
}

/** An activation-owned reviewer child: the run plus its durable session id. */
export interface ReviewerActivation extends ReviewerRun {
  /** The child's durable session id. */
  readonly childId: SessionId
}

/** The capability flags one provider advertises, as far as the reviewer reads them. */
export interface ReviewerProviderCapabilities {
  /** Whether the provider supports a structured-output schema. */
  readonly outputSchema?: boolean
  /** Legacy only: whether the provider supports a per-child tool allow-list. */
  readonly toolFilter?: boolean
}

/** A registered provider, as far as the reviewer reads it. */
export interface ReviewerProvider {
  /** Start-time capabilities; absent on mocks, whose service validates at start. */
  readonly capabilities?: ReviewerProviderCapabilities
}

/** The legacy one-shot start request (`dsh <= 0.2.1-alpha`). */
export interface ReviewerLegacyStartRequest {
  /** Short task label retained in cataloged child membership. */
  readonly label: string
  /** Content delivered as the child's user message. */
  readonly prompt: ContentBlock[]
  /** The spawning agent. */
  readonly parent: Agent
  /** Caller cancellation. */
  readonly signal: AbortSignal
  /** The read-only tool allow-list the reviewer face requires. */
  readonly toolFilter: { readonly allow: readonly string[] }
  /** Structured output the child must satisfy. */
  readonly outputSchema: ObjectJsonSchema
  /** Absolute delegation-depth cap for the child. */
  readonly maxDepth: number
  /** Host-Agent overrides for the child. */
  readonly agentOptions?: ReviewerAgentOptions
}

/** The `ctx.subagents` surface the reviewer consumes, across every host line. */
export interface ReviewerSubagentSeam {
  /** Resolve one registered provider, or undefined when its name is unknown. */
  getProvider(name: string): ReviewerProvider | undefined
  /** Legacy one-shot child start; absent on `0.2.1+` hosts. */
  start?(provider: string, request: ReviewerLegacyStartRequest): Promise<ReviewerLegacyRun>
  /** Activation start; absent on `0.2.1-alpha` hosts. */
  startActivation?(spec: ReviewerActivationSpec): Promise<ReviewerActivation>
}

/**
 * Read the live `ctx.subagents` service through {@link ReviewerSubagentSeam}.
 * @param ctx - the plugin context carrying the subagent service.
 * @returns the structural seam view.
 */
export function reviewerSubagentSeam(ctx: Context): ReviewerSubagentSeam {
  // The single structural escape: `SubagentRuntime` gained `startActivation`
  // and dropped `start` between published lines, so no one declaration carries
  // both. Every reviewer call site uses this view instead of casting again.
  return ctx.subagents as unknown as ReviewerSubagentSeam
}

/** Everything one activation needs, in the host-independent shape. */
export interface ReviewerActivationInput extends ReviewerActivationComposition {
  /** Registered subagent backend to run the child on. */
  readonly provider: string
  /** Short task label retained in cataloged child membership. */
  readonly label: string
  /** Caller cancellation. */
  readonly signal: AbortSignal
}

/**
 * Build the activation spec for either published activation shape.
 * @param input - provider, label, task composition, and cancellation.
 * @returns the flat `0.2.2-rc.3` spec carrying the `0.2.2-rc.1` `request` alias.
 */
export function buildReviewerActivationSpec(input: ReviewerActivationInput): ReviewerActivationSpec {
  const composition: ReviewerActivationComposition = {
    prompt: input.prompt,
    parent: input.parent,
    outputSchema: input.outputSchema,
    maxDepth: input.maxDepth,
    agentPreset: input.agentPreset,
    ...input.agentOptions === undefined ? {} : { agentOptions: input.agentOptions },
  }
  return {
    provider: input.provider,
    label: input.label,
    // Flat half: the rc.3 declaration. Nested half: the rc.1 alias.
    ...composition,
    request: composition,
    signal: input.signal,
    delivery: 'caller',
  }
}
