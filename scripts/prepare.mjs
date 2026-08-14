// Self-contained build used by both `pnpm run build` and the git-install
// `prepare` lifecycle: emits lib/types (tsc declarations) and lib/*.js
// (tsdown bundles: node ESM + browser CJS). Uses ONLY the build tools
// declared in `dependencies` because pnpm does not install devDependencies
// of git-hosted packages.
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)

function binOf(packageName, binKey) {
  const pkgPath = require.resolve(`${packageName}/package.json`)
  const pkg = require(pkgPath)
  const bin = pkg.bin
  const entry = typeof bin === 'string' ? bin : bin?.[binKey]
  if (entry === undefined) throw new Error(`${packageName} declares no "${binKey}" bin`)
  return path.resolve(path.dirname(pkgPath), entry)
}

function run(bin, args) {
  const result = spawnSync(process.execPath, [bin, ...args], { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Remove the previous lib/ output so a rebuild never mixes stale artifacts.
rmSync(new URL('../lib', import.meta.url), { recursive: true, force: true })

run(binOf('typescript', 'tsc'), ['-p', 'tsconfig.json'])
run(binOf('tsdown', 'tsdown'), [])
console.log('build complete: lib/types + lib/index.js + lib/invariant.js + lib/client.js')
