/**
 * The `dsh-eval` command: boots the shipped standalone evaluation
 * composition (`eval/cordis.yml` — Minimal persona, approval `never`,
 * workspace-write sandbox, read/write fs tools, subagent providers), loads
 * one or more YAML suites, and runs every case as an isolated headless
 * agent session through the {@link EvalEngine}.
 *
 * CI gate: the process exits 0 exactly when every case of every suite
 * passed; 1 otherwise; 2 on usage/configuration errors. `--no-gate` disables
 * the gate. SIGINT/SIGTERM abort the run (the second signal force-exits).
 * @module dsh-auto-review/eval-cli
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { resolveConfig } from '../config.ts'
import { parseSuite } from './dsl.ts'
import type { EvalSuite } from './dsl.ts'
import { EvalEngine, evalReviewConfig } from './runner.ts'
import type { SuiteReport } from './runner.ts'
import { exitCodeFor, renderTerminalSummary, writeReports } from './report.ts'

const NAME = 'dsh-eval'

/** Locate package.json from the built layout (`lib/`) or the source layout (`src/eval/`). */
function packageJsonUrl(): URL {
  const built = new URL('../package.json', import.meta.url)
  return existsSync(built) ? built : new URL('../../package.json', import.meta.url)
}

/** The package version, read from package.json (single source of truth). */
const PACKAGE_VERSION: string = (JSON.parse(
  readFileSync(packageJsonUrl(), 'utf8'),
) as { version: string }).version

/** Parsed CLI flags. */
export interface CliFlags {
  readonly suitePaths: readonly string[]
  readonly provider?: string
  readonly model?: string
  readonly tiers: Readonly<Record<string, string>>
  readonly timeoutMs?: number
  readonly concurrency?: number
  readonly out: string
  readonly workspaceRoot?: string
  readonly keepWorkspaces: boolean
  readonly noMarkdown: boolean
  readonly noGate: boolean
  readonly reviewProvider?: string
  readonly reviewModel?: string
  readonly reviewTimeoutMs?: number
}

/** CLI usage/validation error. */
export class CliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliError'
  }
}

/** Parse one integer flag value; throws {@link CliError} on junk. */
function parsePositiveInt(flag: string, raw: string): number {
  const value = Number.parseInt(raw, 10)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CliError(`${flag} must be a positive integer, got ${JSON.stringify(raw)}`)
  }
  return value
}

/** Parse the raw argv (without node/bin). */
export function parseFlags(argv: readonly string[]): CliFlags {
  const args = [...argv]
  const suitePaths: string[] = []
  const tiers: Record<string, string> = {}
  let provider: string | undefined
  let model: string | undefined
  let timeoutMs: number | undefined
  let concurrency: number | undefined
  let out = '.eval-reports'
  let workspaceRoot: string | undefined
  let keepWorkspaces = false
  let noMarkdown = false
  let noGate = false
  let reviewProvider: string | undefined
  let reviewModel: string | undefined
  let reviewTimeoutMs: number | undefined
  const take = (flag: string): string => {
    if (args.length === 0) throw new CliError(`${flag} requires a value`)
    return args.shift() as string
  }
  while (args.length > 0) {
    const arg = args.shift() as string
    const [name, inline] = arg.includes('=') ? arg.split(/=(.*)/su, 2) as [string, string] : [arg, undefined]
    const value = (): string => inline ?? take(name)
    switch (name) {
      case '--provider': provider = value(); break
      case '--model': model = value(); break
      case '--tier': {
        const raw = value()
        const eq = raw.indexOf('=')
        if (eq <= 0 || eq === raw.length - 1) throw new CliError(`--tier expects <name>=<model>, got ${JSON.stringify(raw)}`)
        tiers[raw.slice(0, eq)] = raw.slice(eq + 1)
        break
      }
      case '--timeout-ms': timeoutMs = parsePositiveInt(name, value()); break
      case '--concurrency': concurrency = parsePositiveInt(name, value()); break
      case '--out': out = value(); break
      case '--workspace-root': workspaceRoot = value(); break
      case '--keep-workspaces': keepWorkspaces = true; break
      case '--no-markdown': noMarkdown = true; break
      case '--no-gate': noGate = true; break
      case '--review-provider': reviewProvider = value(); break
      case '--review-model': reviewModel = value(); break
      case '--review-timeout-ms': reviewTimeoutMs = parsePositiveInt(name, value()); break
      case '-h':
      case '--help': throw new HelpRequested()
      case '-V':
      case '--version': throw new VersionRequested()
      default:
        if (name.startsWith('-')) throw new CliError(`unknown flag ${JSON.stringify(name)} (see --help)`)
        suitePaths.push(name)
    }
  }
  if (suitePaths.length === 0) throw new CliError('no suite path given (see --help)')
  return {
    suitePaths,
    ...(provider !== undefined ? { provider } : {}),
    ...(model !== undefined ? { model } : {}),
    tiers,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    out,
    ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
    keepWorkspaces,
    noMarkdown,
    noGate,
    ...(reviewProvider !== undefined ? { reviewProvider } : {}),
    ...(reviewModel !== undefined ? { reviewModel } : {}),
    ...(reviewTimeoutMs !== undefined ? { reviewTimeoutMs } : {}),
  }
}

/** Control-flow marker for `--help`. */
export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

/** Control-flow marker for `--version`. */
export class VersionRequested extends Error {
  constructor() {
    super('version')
    this.name = 'VersionRequested'
  }
}

const HELP = `Usage: dsh-eval <suite.yaml|suite-dir>... [options]

Runs YAML evaluation suites against real headless DSH agent sessions and
reports pass/fail per case. Exits 0 only when every case passed (CI gate).

Options:
  --provider <name>            LLM provider route (default: the composition's
                               deepseek-official adapter)
  --model <model>              Default model for cases without one
  --tier <name>=<model>        Tier → model mapping (repeatable)
  --timeout-ms <n>             Default per-case deadline in milliseconds
  --concurrency <n>            Worker pool size (default 1)
  --out <dir>                  Report directory (default .eval-reports)
  --workspace-root <dir>       Scratch workspace root (default: OS temp dir)
  --keep-workspaces            Do not delete scratch workspaces after the run
  --no-markdown                Skip the Markdown report
  --no-gate                    Exit 0 regardless of failures
  --review-provider <name>     Second-model reviewer subagent provider
  --review-model <model>       Second-model reviewer model
  --review-timeout-ms <n>      Second-model reviewer deadline
  -h, --help                   Show this help
  -V, --version                Show the version

A case whose model/timeout resolves from neither the suite nor the flags is
a configuration error — dsh-eval never substitutes hardcoded defaults.`

/**
 * Expand one suite path: files load directly, directories contribute their
 * `*.yaml`/`*.yml` children (sorted, for stable runs).
 */
export async function resolveSuiteFiles(paths: readonly string[]): Promise<string[]> {
  const files: string[] = []
  for (const raw of paths) {
    const path = resolve(raw)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true })
      const children = entries
        .filter(entry => entry.isFile() && /\.ya?ml$/iu.test(entry.name))
        .map(entry => join(path, entry.name))
        .sort()
      files.push(...children)
    } else {
      files.push(path)
    }
  }
  return files
}

/** The path of the shipped evaluation composition (repo root in dev, package root when built). */
export function compositionPath(): string {
  return fileURLToPath(new URL('../eval/cordis.yml', import.meta.url))
}

/** Boot the evaluation composition and return the root context. */
async function bootComposition(): Promise<import('@deepseek-ai/cordis').Context> {
  loadEnv(NAME)
  return boot(NAME, resolveConfigPath(compositionPath(), undefined))
}

/**
 * The CLI entry: parse flags, boot the composition, run every suite, write
 * reports, and return the process exit code.
 * @param argv - raw arguments (defaults to process.argv.slice(2)).
 * @param io - process-facing streams (tests substitute captures).
 * @returns the exit code.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
  io: { stdout: NodeJS.WriteStream; stderr: NodeJS.WriteStream } = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  let flags: CliFlags
  try {
    flags = parseFlags([...argv])
  } catch (error: unknown) {
    if (error instanceof HelpRequested) {
      io.stdout.write(`${HELP}\n`)
      return 0
    }
    if (error instanceof VersionRequested) {
      io.stdout.write(`${PACKAGE_VERSION}\n`)
      return 0
    }
    io.stderr.write(`dsh-eval: ${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }
  const uninstallFailLoud = installFailLoud(NAME)
  const controller = new AbortController()
  let signalCount = 0
  const onSignal = (): void => {
    signalCount += 1
    if (signalCount >= 2) process.exit(130)
    io.stderr.write('\ndsh-eval: aborting — finishing the active cases, then stopping\n')
    controller.abort()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  let ctx: import('@deepseek-ai/cordis').Context | undefined
  try {
    const suiteFiles = await resolveSuiteFiles(flags.suitePaths)
    const suites: { suite: EvalSuite; sourcePath: string }[] = []
    for (const file of suiteFiles) {
      const text = await readFile(file, 'utf8')
      suites.push({ suite: parseSuite(text, file), sourcePath: file })
    }
    const outDir = resolve(flags.out)
    await mkdir(outDir, { recursive: true })
    // Scratch workspaces default to the OS temp directory: a report directory
    // inside a seeded repository would make the seed copy target its own
    // subtree (EINVAL). Pin a fixed root with --workspace-root.
    const workspaceRoot = isAbsolute(flags.workspaceRoot ?? '')
      ? flags.workspaceRoot as string
      : resolve(flags.workspaceRoot ?? join(tmpdir(), 'dsh-eval-workspaces'))
    // The composition reads these: session-persistence root (replay logs) and
    // the sandbox workspace root.
    process.env.DSH_EVAL_SESSIONS_ROOT = join(outDir, 'sessions')
    process.env.DSH_EVAL_WORKSPACE_ROOT = workspaceRoot
    ctx = await bootComposition()
    const runtime = ctx.get('autoReviewRuntime')
    const base = resolveConfig({})
    const reviewConfig = runtime !== undefined
      ? evalReviewConfig(runtime.config)
      : evalReviewConfig({
        ...base,
        ...(flags.reviewProvider !== undefined ? { reviewerProvider: flags.reviewProvider } : {}),
        ...(flags.reviewModel !== undefined ? { reviewerModel: flags.reviewModel } : {}),
        ...(flags.reviewTimeoutMs !== undefined ? { reviewerTimeoutMs: flags.reviewTimeoutMs } : {}),
      })
    if (runtime !== undefined) {
      io.stderr.write(`dsh-eval: reviewer provider "${reviewConfig.reviewerProvider}", tools [${reviewConfig.reviewerTools.join(', ')}]\n`)
    }
    const engine = new EvalEngine(ctx, reviewConfig)
    const reports: SuiteReport[] = []
    const multi = suites.length > 1
    for (const { suite, sourcePath } of suites) {
      io.stderr.write(`dsh-eval: suite "${suite.name}" (${suite.cases.length} cases, ${sourcePath})\n`)
      const slug = suite.name.replace(/[^A-Za-z0-9._-]/gu, '_') || 'suite'
      const report = await engine.runSuite(suite, {
        provider: flags.provider ?? suite.provider ?? 'deepseek-official',
        ...(flags.model !== undefined ? { cliModel: flags.model } : {}),
        ...(Object.keys(flags.tiers).length > 0 ? { cliTiers: flags.tiers } : {}),
        ...(flags.timeoutMs !== undefined ? { cliTimeoutMs: flags.timeoutMs } : {}),
        concurrency: flags.concurrency ?? suite.concurrency ?? 1,
        signal: controller.signal,
        workspaceRoot,
        suiteDir: dirname(sourcePath),
        keepWorkspaces: flags.keepWorkspaces,
        traceDir: multi ? join(outDir, 'traces', slug) : join(outDir, 'traces'),
        traceLinkBase: multi ? `traces/${slug}` : 'traces',
        onProgress: (progress) => {
          io.stderr.write(`  [${progress.index + 1}/${progress.total}] ${progress.status} ${progress.caseId}\n`)
        },
      })
      reports.push(report)
      await writeReports(
        report,
        outDir,
        multi
          ? { json: `${slug}.json`, markdown: `${slug}.md` }
          : { json: 'report.json', markdown: flags.noMarkdown ? null : 'report.md' },
      )
      io.stdout.write(renderTerminalSummary(report))
      io.stdout.write('\n')
    }
    const gate = reports.every(report => exitCodeFor(report) === 0)
    io.stderr.write(`dsh-eval: reports in ${outDir}\n`)
    return flags.noGate || gate ? 0 : 1
  } catch (error: unknown) {
    io.stderr.write(`dsh-eval: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    return 2
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    if (ctx !== undefined) {
      try {
        await ctx.fiber.dispose()
      } catch (error: unknown) {
        io.stderr.write(`dsh-eval: dispose failed: ${String(error)}\n`)
      }
    }
    uninstallFailLoud()
  }
}
