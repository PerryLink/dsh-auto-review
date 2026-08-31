/**
 * Host-version watch for the pre-release pins. The peers pin
 * `@deepseek-ai/dsh-*` to the rc line they are built against (exact
 * `0.1.x-rc.N` or the `>=0.1.x-rc.N <0.2.0` range); when the umbrella
 * `@deepseek-ai/dsh` publishes a newer rc line (on any dist-tag), this
 * script fails so the bump happens BEFORE a publish, not after a broken
 * install. The npm `alpha` release line (`0.1.x-alpha.N`) cannot be
 * expressed by the rc peer ranges, so the exact dev-pinned alpha line is
 * its coverage: a newer registry alpha also fails the check (bump the dev
 * pins, or document a deliberate stay-behind).
 *
 * Network failure is not a failure here: an offline machine must not block
 * the gate, it only skips the check.
 */

import { readFile } from 'node:fs/promises'

const EXACT_PIN = /^0\.1\.(\d+)-rc\.(\d+)$/u
const RANGE_PIN = /^>=0\.1\.(\d+)-rc\.(\d+) <0\.2\.0$/u
const ALPHA_PIN = /^0\.1\.(\d+)-alpha\.(\d+)$/u

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const pinned = Object.entries(pkg.peerDependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
  .map(([name, range]) => {
    const exact = EXACT_PIN.exec(range)
    if (exact !== null) return { name, minor: Number(exact[1]), rc: Number(exact[2]), exact: true }
    const rangePin = RANGE_PIN.exec(range)
    if (rangePin !== null) return { name, minor: Number(rangePin[1]), rc: Number(rangePin[2]), exact: false }
    return null
  })
  .filter(entry => entry !== null)

if (pinned.length === 0) {
  console.error('check-host-versions: no rc-pinned @deepseek-ai/dsh-* peers found')
  process.exit(1)
}

let tags
try {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh', {
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`registry responded ${response.status}`)
  tags = (await response.json())['dist-tags']
} catch (error) {
  console.warn(`check-host-versions: registry unreachable (${error instanceof Error ? error.message : String(error)}); skipping`)
  process.exit(0)
}

// Newest published rc line among the dist-tags (both 0.1.0-rc.N and 0.1.1-rc.N lines).
const newest = Object.values(tags)
  .map(tag => EXACT_PIN.exec(String(tag)))
  .filter(match => match !== null)
  .map(match => ({ minor: Number(match[1]), rc: Number(match[2]) }))
  .sort((left, right) => (left.minor - right.minor) || (left.rc - right.rc))
  .at(-1)

if (newest === undefined) {
  console.warn('check-host-versions: no parseable rc line on the registry; skipping')
  process.exit(0)
}

// A peer pin covers `newest` when its lower bound is at or below it: exact
// pins cover only the identical `0.1.x-rc.N` line; range pins cover every
// later minor and, within the same minor, every rc >= the bound.
const stale = pinned.filter(pin =>
  pin.exact
    ? pin.minor !== newest.minor || pin.rc !== newest.rc
    : pin.minor > newest.minor || (pin.minor === newest.minor && pin.rc > newest.rc),
)

if (stale.length > 0) {
  console.error(
    `check-host-versions: @deepseek-ai/dsh newest rc line is 0.1.${newest.minor}-rc.${newest.rc}, but the peers pin older: `
    + `${stale.map(pin => `${pin.name}@0.1.${pin.minor}-rc.${pin.rc}`).join(', ')}. `
    + 'Bump the pins (or document a deliberate stay-behind) before publishing.',
  )
  process.exit(1)
}

console.log(`check-host-versions: peers cover the newest @deepseek-ai/dsh rc line (0.1.${newest.minor}-rc.${newest.rc})`)

// The alpha release line is covered by the exact dev pins (the rc peer
// ranges cannot express `0.1.x-alpha.N`); fail when the registry alpha
// line outruns them.
const newestAlpha = Object.values(tags)
  .map(tag => ALPHA_PIN.exec(String(tag)))
  .filter(match => match !== null)
  .map(match => ({ minor: Number(match[1]), alpha: Number(match[2]) }))
  .sort((left, right) => (left.minor - right.minor) || (left.alpha - right.alpha))
  .at(-1)

const devAlpha = Object.entries(pkg.devDependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
  .map(([, version]) => ALPHA_PIN.exec(String(version)))
  .filter(match => match !== null)
  .map(match => ({ minor: Number(match[1]), alpha: Number(match[2]) }))
  .sort((left, right) => (left.minor - right.minor) || (left.alpha - right.alpha))
  .at(-1)

if (newestAlpha !== undefined) {
  const covered = devAlpha !== undefined
    && (devAlpha.minor > newestAlpha.minor
      || (devAlpha.minor === newestAlpha.minor && devAlpha.alpha >= newestAlpha.alpha))
  if (!covered) {
    console.error(
      `check-host-versions: @deepseek-ai/dsh newest alpha line is 0.1.${newestAlpha.minor}-alpha.${newestAlpha.alpha}, but the dev pins cover ${devAlpha === undefined ? 'no alpha line' : `0.1.${devAlpha.minor}-alpha.${devAlpha.alpha}`}. `
      + 'Bump the dev pins (or document a deliberate stay-behind) before publishing.',
    )
    process.exit(1)
  }
  console.log(`check-host-versions: dev pins cover the newest @deepseek-ai/dsh alpha line (0.1.${newestAlpha.minor}-alpha.${newestAlpha.alpha})`)
}
