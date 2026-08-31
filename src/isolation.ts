/**
 * The reviewer child's context firewall.
 *
 * The reviewer is an ordinary agent, so the harness composes its steps the
 * ordinary way: the loop's own runtime-context snapshot, the workspace
 * instruction files (`AGENTS.md` / `CLAUDE.md`, injected by
 * `dsh-agent-instructions`), and every context-injecting plugin the user
 * happens to have installed all enter the child ABOVE the reviewer prompt.
 * None of that is evidence about the reviewed call, and the workspace half is
 * authored by whoever can write to the repository under review — a teammate, a
 * PR branch, a dependency shipping its own `AGENTS.md` — which puts
 * repository-controlled text inside the component that decides whether a
 * privileged operation is allowed, above a prompt that says "judge the call
 * from the evidence below ONLY".
 *
 * The subagent seam has no "bare child" construction: `SubagentStartRequest`
 * scopes the child's TOOLS (`toolFilter`) and its persona, not the messages
 * that enter its steps. `agent/pre-step` is the documented seam for exactly
 * that — "reject a proposed step or replace the messages that enter it" — and
 * it is the last waterfall before the loop appends those messages to the
 * child's log, so filtering there keeps the reviewer's own session log an
 * honest record of what it saw.
 *
 * The filter is an ALLOW-LIST over message sources, like `reviewerTools` is an
 * allow-list over tools: a source this module does not know about is dropped,
 * so a plugin that merges a new `MessageSource` kind cannot reach the reviewer
 * by being new.
 * @module dsh-auto-review/isolation
 */

import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

/**
 * The message sources a reviewer child may see:
 *
 * - `user` — the reviewer prompt itself, delivered by the subagent driver as
 *   the child's one user message.
 * - `tool` — the results of the read-only tools the reviewer called; dropping
 *   these would blind the reviewer to its own `read`/`glob`/`grep` output.
 *
 * Everything else is injected context: `plugin` covers the loop's
 * runtime-context snapshot and third-party injections, and out-of-repo
 * producers (the workspace instruction loader among them) declare their own
 * merge-extended `kind`. All of it is dropped.
 */
export const REVIEWER_MESSAGE_SOURCES: ReadonlySet<string> = new Set(['user', 'tool'])

/**
 * Whether one step message is the reviewer's own material rather than context
 * injected around it.
 * @param message - a message proposed for the reviewer child's next step.
 * @returns true when its source is on {@link REVIEWER_MESSAGE_SOURCES}.
 */
export function isReviewerOwnedMessage(message: UserMessage): boolean {
  return REVIEWER_MESSAGE_SOURCES.has(message.source.kind)
}

/**
 * Drop every injected-context message from a proposed step.
 * @param messages - the messages the waterfall would let into the step.
 * @returns only the reviewer's own prompt and tool results, in order.
 */
export function stripInjectedContext(messages: readonly UserMessage[]): UserMessage[] {
  return messages.filter(message => isReviewerOwnedMessage(message))
}

/** The text blocks of a message joined as one string (the correlation key). */
function messageText(content: readonly ContentBlock[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => (block as { text: string }).text)
    .join('\n')
}

/**
 * The live reviewer children of one mount: which sessions are reviewers, so
 * the answerer can delegate their own approval asks (anti-recursion) and the
 * firewall knows whose steps to filter.
 *
 * A reviewer child is recognized TWICE, because its id and its first step race
 * each other. `ctx.subagents.start` only resolves the child's session id after
 * the in-process driver has already delivered the prompt and woken the child's
 * loop, so a firewall keyed on the id alone could miss the very first step —
 * the one that carries the injected workspace instructions. {@link expect}
 * therefore registers the exact prompt text BEFORE the start call, and
 * {@link claims} latches the child's id the first time it sees that prompt
 * claimed into a step. The id path takes over for every later step, whose
 * claimed messages are tool results rather than the prompt.
 */
export class ReviewerChildren {
  /** Reviewer child sessions currently under review, by id. */
  private readonly sessions = new Set<SessionId>()

  /** Prompt texts of reviewer children whose start has not resolved yet. */
  private readonly pendingPrompts = new Set<string>()

  /**
   * Announce a reviewer child about to be started, by the exact prompt text
   * it will be given.
   * @param promptText - the built reviewer prompt.
   * @returns a disposer that withdraws the announcement (call it when the run
   *   settles; the id latched by {@link claims} keeps identifying the child).
   */
  expect(promptText: string): () => void {
    this.pendingPrompts.add(promptText)
    return () => {
      this.pendingPrompts.delete(promptText)
    }
  }

  /** Record a reviewer child's session id once the start resolved it. */
  add(id: SessionId): void {
    this.sessions.add(id)
  }

  /** Forget a settled reviewer child. */
  delete(id: SessionId): void {
    this.sessions.delete(id)
  }

  /** Whether `id` is a live reviewer child (the answerer's anti-recursion test). */
  has(id: SessionId): boolean {
    return this.sessions.has(id)
  }

  /**
   * Whether a proposed step belongs to a reviewer child, latching the child's
   * id the first time its announced prompt is recognized.
   * @param agent - the agent proposing the step.
   * @param messages - the messages claimed from its inbox for that step.
   * @returns true when the step is a reviewer child's.
   */
  claims(agent: Agent, messages: readonly UserMessage[]): boolean {
    if (this.sessions.has(agent.id)) return true
    if (this.pendingPrompts.size === 0) return false
    for (const message of messages) {
      if (message.source.kind !== 'user') continue
      if (!this.pendingPrompts.has(messageText(message.content))) continue
      this.sessions.add(agent.id)
      return true
    }
    return false
  }
}

/**
 * The `agent/pre-step` half of the firewall: for a reviewer child only, keep
 * the allow-listed messages and drop the injected context the rest of the
 * waterfall (and the loop's own default) proposed.
 *
 * Registered with `prepend: true` so it wraps the whole chain and inspects the
 * FINAL message list — every injection is removed regardless of which listener
 * added it. A non-reviewer step is returned untouched, so no other agent's
 * context is affected.
 * @param children - the mount's reviewer-child registry.
 * @param payload - the proposed step.
 * @param next - the rest of the pre-step waterfall.
 * @returns the decision, with injected context removed for reviewer children.
 */
export async function guardReviewerContext(
  children: ReviewerChildren,
  payload: { agent: Agent; messages: UserMessage[] },
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision> {
  // Claimed BEFORE the chain runs: the prompt that identifies a first step is
  // what the loop took out of the inbox, not what the chain adds around it.
  const reviewer = children.claims(payload.agent, payload.messages)
  const decision = await next()
  if (!reviewer || decision.kind !== 'enter') return decision
  const kept = stripInjectedContext(decision.messages)
  if (kept.length === decision.messages.length) return decision
  return { ...decision, messages: kept }
}
