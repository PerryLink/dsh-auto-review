/**
 * The dsh-eval case DSL: YAML suites of agent-evaluation cases. Each case
 * runs one isolated headless agent session; the `expect` block asserts on
 * the collected tool-call trace, tool results, final output, and token
 * budget; the optional `review` block adds a second-model review as a
 * supplementary assertion layer (reusing the same subagent seam as the
 * approval reviewer).
 *
 * Every type here is plain owned JSON — nothing crosses into session logs or
 * prompts without passing through the runners, and none of it carries live
 * Cordis/DSH references.
 * @module dsh-auto-review/eval/dsl
 */

import { parseDocument, YAMLParseError } from 'yaml'
import { z } from 'zod'

/** A `tool` expectation name: an exact name, or a suffix wildcard ending in `*`. */
const TOOL_PATTERN = z.string().min(1)

/** Deep-partial argument matcher: every key in `contains` must exist (recursively) in the actual arguments. */
const ARGUMENT_CONTAINS = z.record(z.string(), z.unknown())

/** Deep-equal argument matcher: the actual parsed arguments must equal this value exactly. */
const ARGUMENT_EQUALS = z.unknown()

/** Regex argument matcher: every key's value must be a string matching the regex against the actual string value. */
const ARGUMENT_MATCHES = z.record(z.string(), z.string().min(1))

/** Argument expectation: exactly one matcher kind. */
const ARGUMENT_EXPECTATION = z.object({
  contains: ARGUMENT_CONTAINS.optional(),
  equals: ARGUMENT_EQUALS.optional(),
  matches: ARGUMENT_MATCHES.optional(),
}).refine(value => Object.keys(value).length === 1, {
  message: 'arguments expectation must declare exactly one of: contains, equals, matches',
})

/** One entry of the ordered tool-call sequence expectation. */
const TOOL_CALL_EXPECTATION = z.object({
  /** Exact tool name, or a suffix wildcard ending in `*` (matches any tool with that suffix). */
  tool: TOOL_PATTERN,
  /** Optional argument matcher applied to the matched call's parsed arguments. */
  arguments: ARGUMENT_EXPECTATION.optional(),
})

/** One tool-result expectation: assert on the result of the n-th call of a tool. */
const RESULT_EXPECTATION = z.object({
  /** The tool whose result is asserted; a `*` suffix wildcard is allowed. */
  tool: TOOL_PATTERN,
  /** The occurrence to assert (0 = first call of that tool). Default 0. */
  index: z.number().int().min(0).default(0),
  /** The call's result must be an error exactly when true. */
  isError: z.boolean().optional(),
  /** The result text must contain this substring. */
  contains: z.string().optional(),
  /** The result text must match this regular expression (unanchored). */
  regex: z.string().optional(),
}).refine(value => value.isError !== undefined || value.contains !== undefined || value.regex !== undefined, {
  message: 'result expectation must declare at least one of: isError, contains, regex',
})

/** Final-output (last non-empty assistant text) assertions. */
const OUTPUT_EXPECTATION = z.object({
  /** The final output must contain this substring. */
  contains: z.string().optional(),
  /** The final output must NOT contain this substring. */
  notContains: z.string().optional(),
  /** The final output must match this regular expression (unanchored). */
  regex: z.string().optional(),
  /** The final output must NOT match this regular expression. */
  notRegex: z.string().optional(),
}).refine(
  value => value.contains !== undefined || value.notContains !== undefined
    || value.regex !== undefined || value.notRegex !== undefined,
  { message: 'output expectation must declare at least one of: contains, notContains, regex, notRegex' },
)

/** Structured expectation block of one case. */
const EXPECTATION = z.object({
  /** The ordered tool-call sequence expectation: each entry consumes the earliest still-unconsumed matching call (skips allowed). */
  toolCalls: z.array(TOOL_CALL_EXPECTATION).default(() => []),
  /** Exact tool-name sequence: the actual call names must equal this list with no skips. */
  toolCallsExact: z.array(z.string().min(1)).optional(),
  /** The case must produce zero tool calls exactly when true. */
  noToolCalls: z.boolean().optional(),
  /** Per-tool-result assertions. */
  results: z.array(RESULT_EXPECTATION).default(() => []),
  /** Final-output assertions. */
  output: OUTPUT_EXPECTATION.optional(),
  /** How the final turn must end. Default `completed`. */
  turnEnds: z.enum(['completed', 'any']).default('completed'),
  /** Total output tokens (summed across steps) must stay at or below this. */
  maxTokens: z.number().int().min(0).optional(),
})

/** Second-model review block: a supplementary assertion layer over the same run. */
const REVIEW = z.object({
  /** One sentence describing what must hold for the case to pass. */
  statement: z.string().min(1),
  /** Optional additional judgement criteria, one bullet each. */
  criteria: z.array(z.string().min(1)).default(() => []),
  /** Optional reviewer model id; falls back to the engine's configured reviewer model. */
  model: z.string().optional(),
})

/** One workspace seed file written before the case agent starts. */
const SEED_FILE = z.object({
  /** Workspace-relative path; parent directories are created. Must stay inside the workspace. */
  path: z.string().min(1).refine(value => !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split('/').includes('..'), {
    message: 'files[].path must be a relative path inside the workspace (no absolute paths, no ..)',
  }),
  /** File content. */
  content: z.string().default(''),
})

/** One evaluation case. */
const CASE = z.object({
  /** Stable case id (unique inside the suite; file name when absent). */
  id: z.string().min(1),
  /** Human-readable description, shown in reports. */
  description: z.string().optional(),
  /** The task text submitted to the agent. */
  input: z.string().min(1),
  /** Direct model id for this case. */
  model: z.string().optional(),
  /** Model tier name, resolved through `suite.models.tiers` or the CLI `--tier`. */
  tier: z.string().optional(),
  /** Per-case turn deadline in milliseconds. Beats suite/CLI defaults. */
  timeoutMs: z.number().int().positive().optional(),
  /** Per-case agent maxTokens (output cap per model request). */
  maxTokens: z.number().int().positive().optional(),
  /**
   * A directory copied into the workspace root before the agent starts
   * (relative to the suite file, or absolute). `node_modules`, `.git`,
   * `.eval-reports`, `.sessions`, `lib`, and `coverage` are excluded.
   */
  seedFrom: z.string().optional(),
  /** Workspace seed files. */
  files: z.array(SEED_FILE).default(() => []),
  /** The structured assertion block. */
  expect: EXPECTATION.default(() => ({ toolCalls: [], results: [], turnEnds: 'completed' as const })),
  /** Optional second-model review block. */
  review: REVIEW.optional(),
}).refine(value => value.model === undefined || value.tier === undefined, {
  message: 'case must not set both `model` and `tier` (tier resolves through suite models.tiers)',
})

/** Suite-level model resolution table. */
const MODELS = z.object({
  /** Suite default model id; the CLI `--model` beats it. */
  default: z.string().optional(),
  /** Tier name → model id, resolved by `case.tier` and the CLI `--tier`. */
  tiers: z.record(z.string(), z.string().min(1)).default(() => ({})),
})

/** One evaluation suite. */
const SUITE = z.object({
  /** Suite name, shown in reports. */
  name: z.string().min(1),
  /** Optional description. */
  description: z.string().optional(),
  /** Provider route for all cases; the CLI `--provider` beats it. */
  provider: z.string().optional(),
  /** Model resolution table. */
  models: MODELS.default(() => ({ tiers: {} })),
  /** Suite-wide per-case timeout default in milliseconds. */
  timeoutMs: z.number().int().positive().optional(),
  /** Worker cap for this suite; the CLI `--concurrency` beats it. */
  concurrency: z.number().int().positive().optional(),
  /** The cases, in run order. */
  cases: z.array(CASE).min(1),
}).refine(value => {
  const ids = new Set<string>()
  for (const item of value.cases) {
    if (ids.has(item.id)) return false
    ids.add(item.id)
  }
  return true
}, { message: 'suite case ids must be unique' })

/** A validated suite (zod-inferred: every optional field resolved to an explicit shape). */
export type EvalSuite = z.infer<typeof SUITE>

/** A validated case. */
export type EvalCase = z.infer<typeof CASE>

/** One ordered tool-call expectation. */
export type ToolCallExpectation = z.infer<typeof TOOL_CALL_EXPECTATION>

/** One tool-result expectation. */
export type ResultExpectation = z.infer<typeof RESULT_EXPECTATION>

/** Final-output expectation. */
export type OutputExpectation = z.infer<typeof OUTPUT_EXPECTATION>

/** Suite schema (zod v4). */
export const SuiteSchema: z.ZodType<EvalSuite> = SUITE

/** The parsed-DSL file facts, for error messages and reporting. */
export interface ParsedSuite {
  /** The suite. */
  readonly suite: EvalSuite
  /** The absolute source path, when the suite came from a file. */
  readonly sourcePath?: string
}

/**
 * One DSL validation failure, carrying the exact YAML/validation message.
 * Parsing never throws for bad user input: it reports instead.
 */
export class DslError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DslError'
  }
}

/**
 * Parse and validate one suite document (YAML text).
 * @param text - the YAML source.
 * @param sourcePath - optional path used in error messages.
 * @returns the validated suite.
 * @throws {DslError} on YAML syntax errors or schema violations.
 */
export function parseSuite(text: string, sourcePath?: string): EvalSuite {
  const doc = parseDocument(text, { uniqueKeys: true })
  const problems = doc.errors.map(error => `${error.message} (line ${error.linePos?.at(0)?.line ?? '?'})`).join('; ')
  if (problems !== '') {
    throw new DslError(`invalid YAML in ${sourcePath ?? '<suite>'}: ${problems}`)
  }
  let value: unknown
  try {
    value = doc.toJS()
  } catch (error: unknown) {
    throw new DslError(`cannot decode YAML in ${sourcePath ?? '<suite>'}: ${error instanceof YAMLParseError ? error.message : String(error)}`)
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    throw new DslError(`suite ${sourcePath ?? '<suite>'} must be a YAML mapping`)
  }
  // Accept both the bare mapping and the wrapped `suite:` document shape.
  const record = value as Record<string, unknown>
  if (record.suite !== undefined && typeof record.suite === 'object' && record.suite !== null) {
    value = record.suite
  }
  const result = SUITE.safeParse(value)
  if (!result.success) {
    const details = result.error.issues.map(issue => `${issue.path.join('.') || '(suite)'}: ${issue.message}`).join('; ')
    throw new DslError(`invalid suite ${sourcePath ?? '<suite>'}: ${details}`)
  }
  return result.data
}

/** The model/provider resolution table applied per run (see runner). */
export interface ResolvedModelTable {
  /** The provider route every case uses. */
  readonly provider: string
  /** CLI-supplied default model, when present. */
  readonly cliModel?: string
  /** CLI-supplied tier overrides, merged over suite tiers. */
  readonly cliTiers: Readonly<Record<string, string>>
}

/**
 * Resolve one case's model id: case.model, then case.tier through the
 * merged tier table, then the suite default, then the CLI default.
 * Returns undefined when nothing resolves it — the runner rejects loudly
 * (no hardcoded model).
 * @param caze - the case.
 * @param suite - the owning suite.
 * @param table - the run's resolution table.
 * @returns the model id, or undefined.
 */
export function resolveCaseModel(caze: EvalCase, suite: EvalSuite, table: ResolvedModelTable): string | undefined {
  if (caze.model !== undefined) return caze.model
  if (caze.tier !== undefined) {
    return table.cliTiers[caze.tier] ?? suite.models.tiers[caze.tier] ?? caze.model
  }
  return suite.models.default ?? table.cliModel
}

/**
 * Resolve one case's timeout: case.timeoutMs, then suite.timeoutMs, then the
 * CLI default. Returns undefined when nothing resolves it — the runner
 * rejects loudly (no hardcoded timeout).
 * @param caze - the case.
 * @param suite - the owning suite.
 * @param cliTimeoutMs - the CLI-supplied default, when present.
 * @returns the timeout in milliseconds, or undefined.
 */
export function resolveCaseTimeout(caze: EvalCase, suite: EvalSuite, cliTimeoutMs?: number): number | undefined {
  return caze.timeoutMs ?? suite.timeoutMs ?? cliTimeoutMs
}
