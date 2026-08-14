/**
 * Host-version watch for the pre-release exact peer pins. The peers pin
 * `@deepseek-ai/dsh-*` to the exact rc they are built against; when the
 * umbrella `@deepseek-ai/dsh` publishes a newer version, this script fails
 * so the bump (or a documented stay-behind decision) happens BEFORE a
 * publish, not after a broken install.
 *
 * Network failure is not a failure here: an offline machine must not block
 * the gate, it only skips the check.
 */

import { readFile } from 'node:fs/promises'

const EXACT_PIN = /^\d+\.\d+\.\d+-rc\.\d+$/u

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const pinned = Object.entries(pkg.peerDependencies ?? {})
  .filter(([name, range]) => name.startsWith('@deepseek-ai/dsh') && EXACT_PIN.test(range))

if (pinned.length === 0) {
  console.error('check-host-versions: no exact-pinned @deepseek-ai/dsh-* peers found')
  process.exit(1)
}

let latest
try {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai/dsh', {
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`registry responded ${response.status}`)
  latest = (await response.json())['dist-tags'].latest
} catch (error) {
  console.warn(`check-host-versions: registry unreachable (${error instanceof Error ? error.message : String(error)}); skipping`)
  process.exit(0)
}

const stale = pinned.filter(([, range]) => range !== latest)
if (stale.length > 0) {
  console.error(
    `check-host-versions: @deepseek-ai/dsh latest is ${latest}, but the peers pin exactly: `
    + `${pinned.map(([name, range]) => `${name}@${range}`).join(', ')}. `
    + 'Bump the pins (or document a deliberate stay-behind) before publishing.',
  )
  process.exit(1)
}

console.log(`check-host-versions: peers match the latest @deepseek-ai/dsh (${latest})`)
