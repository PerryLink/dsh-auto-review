// Smoke test for the PACKED artifact: takes the directory the CI job packed
// the tarball into, installs that tarball into a scratch project, and loads
// the node faces (main + invariant) through their package exports. This
// proves the published package installs from a tarball with no external
// references and that `exports`, `main`, and the shipped `lib/` are coherent.
// The client bundle is browser-only (its entry references `window`), so it is
// verified structurally instead of imported.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptRoot = path.dirname(fileURLToPath(import.meta.url))

function fail(message) {
  console.error(`smoke-package: ${message}`)
  process.exit(1)
}

const outDir = process.argv[2] === undefined
  ? path.join(scriptRoot, '..', 'out')
  : path.resolve(process.argv[2])

if (!existsSync(outDir)) fail(`tarball directory ${outDir} does not exist (run pnpm pack --pack-destination out first)`)
const tarballs = readdirSync(outDir).filter(name => name.endsWith('.tgz'))
if (tarballs.length !== 1) fail(`expected exactly one .tgz in ${outDir}, found ${tarballs.length}`)
const tarball = path.resolve(outDir, tarballs[0])

// The tarball's package.json must agree with the checkout (a version bump
// without a repack fails here, before anything publishes).
const pkg = JSON.parse(readFileSync(path.join(scriptRoot, '..', 'package.json'), 'utf8'))

const scratch = mkdtempSync(path.join(tmpdir(), 'dsh-auto-review-smoke-'))
const checkFile = path.join(scratch, 'check.mjs')
// The tarball goes in as a `file:` dependency: npm is then invoked with fixed
// arguments only (no path on the command line, so Windows .cmd quoting and
// tmpdir paths with spaces cannot break the spawn).
writeFileSync(path.join(scratch, 'package.json'), JSON.stringify({
  name: 'smoke',
  private: true,
  dependencies: { 'dsh-auto-review': `file:${tarball.replace(/\\/g, '/')}` },
}))
writeFileSync(checkFile, `
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
// resolve from the package root, then join: the exports map is strict and
// does not expose lib/* subpaths (which is itself part of what we verify).
const packageRoot = path.dirname(require.resolve('dsh-auto-review/package.json'))
const pkgFile = (relative) => path.join(packageRoot, relative)
const tarballName = ${JSON.stringify(tarballs[0])}
const pkgVersion = ${JSON.stringify(pkg.version)}
assert.equal(tarballName, \`dsh-auto-review-\${pkgVersion}.tgz\`, 'tarball filename must carry the package version')
const main = await import('dsh-auto-review')
assert.equal(main.name, 'auto-review', 'node face name')
assert.deepEqual(main.inject, ['approval', 'subagents', 'commands', 'tools'], 'node face inject')
assert.equal(typeof main.apply, 'function', 'node face apply')
assert.equal(typeof main.resolveConfig, 'function', 'resolveConfig export')
assert.equal(typeof main.makeAutoReviewProjection, 'function', 'projection export')
const invariant = await import('dsh-auto-review/invariant')
assert.equal(invariant.name, 'auto-review-invariant', 'invariant face name')
assert.deepEqual(invariant.inject, ['invariants'], 'invariant face inject')
assert.equal(typeof invariant.apply, 'function', 'invariant face apply')
const installed = JSON.parse(readFileSync(pkgFile('package.json'), 'utf8'))
assert.equal(installed.version, pkgVersion, 'installed package version')
assert.ok(existsSync(pkgFile('lib/client.js')), 'client bundle shipped')
assert.ok(existsSync(pkgFile('cordis.patch.yml')), 'bundle patch shipped')
console.log('smoke-package: node faces load, exports resolve, artifact contents verified')
`)
try {
  // `shell: true` lets the same `npm` name work on every platform (Windows
  // resolves npm.cmd through cmd.exe; CI shells resolve the npm binary).
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], {
    cwd: scratch,
    stdio: 'inherit',
    shell: true,
  })
  if (install.error !== undefined) throw install.error
  if (install.status !== 0) fail(`npm install of the tarball failed (exit ${install.status ?? 1})`)
  const load = spawnSync(process.execPath, [checkFile], { cwd: scratch, stdio: 'inherit' })
  if (load.error !== undefined) throw load.error
  if (load.status !== 0) fail(`loading the installed package failed (exit ${load.status ?? 1})`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
