/**
 * Host-version watch for the pre-release peer pins. The peers pin
 * `@deepseek-ai/dsh-*` to the rc line they are built against (exact
 * `0.1.0-rc.N` or the `>=0.1.0-rc.N <0.2.0` range); when the umbrella
 * `@deepseek-ai/dsh` publishes a newer line (on `latest` or `next`), this
 * script fails so the bump happens BEFORE a publish, not after a broken
 * install.
 *
 * Network failure is not a failure here: an offline machine must not block
 * the gate, it only skips the check.
 */

import { readFile } from 'node:fs/promises'

const EXACT_PIN = /^0\.1\.0-rc\.(\d+)$/u
const RANGE_PIN = /^>=0\.1\.0-rc\.(\d+) <0\.2\.0$/u

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const pinned = Object.entries(pkg.peerDependencies ?? {})
  .filter(([name, range]) => name.startsWith('@deepseek-ai/dsh'))
  .map(([name, range]) => {
    const exact = EXACT_PIN.exec(range)
    if (exact !== null) return [name, Number(exact[1])]
    const rangePin = RANGE_PIN.exec(range)
    if (rangePin !== null) return [name, Number(rangePin[1])]
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

const newest = Math.max(
  ...Object.values(tags)
    .map(tag => EXACT_PIN.exec(String(tag)))
    .filter(match => match !== null)
    .map(match => Number(match[1])),
)

if (!Number.isFinite(newest)) {
  console.warn('check-host-versions: no parseable rc line on the registry; skipping')
  process.exit(0)
}

const stale = pinned.filter(([, rc]) => rc < newest)
if (stale.length > 0) {
  console.error(
    `check-host-versions: @deepseek-ai/dsh newest rc line is rc.${newest}, but the peers pin older: `
    + `${stale.map(([name, rc]) => `${name}@0.1.0-rc.${rc}`).join(', ')}. `
    + 'Bump the pins (or document a deliberate stay-behind) before publishing.',
  )
  process.exit(1)
}

console.log(`check-host-versions: peers cover the newest @deepseek-ai/dsh rc line (0.1.0-rc.${newest})`)
