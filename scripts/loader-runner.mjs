// scripts/loader-runner.mjs — real Loader composition runner (community
// five-layer model, layer 4). An independent process boots a real Context,
// mounts the vendored Loader with the Include builtin, reads the given
// cordis.yml (service rows + plugin row + config), then asserts the plugin's
// contributions through the authoritative registries and executes one real
// behavior. Config is applied by the Loader, so the expected outcome proves
// the config in the file was honored.
//
// The `approval` / `commands` services compose as real rows from this
// repository's dependency tree; the two heavyweight inject services the
// plugin never drives directly (`subagents` — only reached by a real AI
// review — and `tools` — read only as the waterfall name) are provided
// in-process, mirroring the test harness. The `never` policy below never
// spawns a reviewer, so the answerer settles deterministically.
//
// Usage: node scripts/loader-runner.mjs <cordis.yml> [answerer]
// Exit 0 prints DSH_LOADER_RESULT <json>; a load failure (invalid config,
// default export) exits non-zero with the reason on stderr.

import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const configArgument = process.argv[2]
const mode = process.argv[3] ?? 'answerer'
if (configArgument === undefined || (mode !== 'answerer' && mode !== 'load-only')) {
  console.error('usage: loader-runner.mjs <cordis.yml> [answerer|load-only]')
  process.exit(2)
}

const configPath = resolve(configArgument)
// Resolve bare package rows from this repository's dependency tree so the
// composition works with config files written anywhere (e.g. a temp dir).
const configRequire = createRequire(resolve(import.meta.dirname, '../package.json'))

/** A structurally complete fake agent over a real session. */
function makeAgent(ctx, session) {
  return {
    id: session.id,
    options: {},
    session,
    inbox: {},
    status: 'idle',
    ctx,
    cancel: () => undefined,
    whenIdle: async () => undefined,
    runMaintenance: async (task) => task(new AbortController().signal),
    send: () => undefined,
    followup: () => undefined,
    steer: () => undefined,
    inject: () => undefined,
  }
}

const ctx = new Context()
try {
  ctx.baseUrl = `${pathToFileURL(dirname(configPath)).href}/`
  ctx.provide('tools', {})
  ctx.provide('subagents', {
    getProvider: () => undefined,
    start: async () => { throw new Error('no subagent provider in the loader composition') },
  })
  await ctx.plugin(Loader)
  ctx.loader.internal = /** @type {any} */ ({
    version: 'v2',
    async import(specifier) {
      if (specifier.startsWith('file:')) return import(specifier)
      if (specifier.startsWith('node:')) return import(specifier)
      const absolute = /^([a-zA-Z]:)?[\\/]/u.test(specifier)
      return import(pathToFileURL(absolute ? specifier : configRequire.resolve(specifier)).href)
    },
  })
  ctx.loader.builtins.include = Include
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()

  if (mode === 'load-only') {
    process.stdout.write('DSH_LOADER_RESULT {"mounted":true}\n')
  } else {
    // Authoritative registries carry the plugin's contributions.
    const session = ctx.sessions.create(SessionId('auto-review-loader-runner'))
    session.append('turn/start', { turn: 1 })
    const agent = makeAgent(ctx, session)
    if (ctx.commands.list(agent).find(entry => entry.name === 'auto-review') === undefined) {
      throw new Error('Loader composition: /auto-review command is missing from the commands registry')
    }

    // Real behavior: the approval/request waterfall through the composed
    // answerer. The `toolsPolicy.default: never` config makes any ask settle
    // `rejected`; the default `human` would delegate to the downstream
    // `allowed-once`, so the outcome pins the config the Loader applied.
    const outcome = await ctx.waterfall(
      'approval/request',
      { agent, toolName: 'bash', reason: 'loader smoke' },
      () => Promise.resolve('allowed-once'),
    )
    if (outcome !== 'rejected') {
      throw new Error(`Loader composition: expected rejected (never policy), got ${JSON.stringify(outcome)}`)
    }

    const summary = { command: 'auto-review', outcome }
    process.stdout.write(`DSH_LOADER_RESULT ${JSON.stringify(summary)}\n`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
} finally {
  await ctx.fiber.dispose()
}
