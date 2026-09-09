/**
 * Host-version watch for the pre-release pins. The peers pin
 * `@deepseek-ai/dsh-*` to the lines they are built against — an exact
 * `0.1.x-rc.N` / `0.1.x-alpha.N`, a `>=0.1.x-rc.N <0.2.0` range, or a `||`
 * union of such segments (the dual-line peers express the rc floor and the
 * alpha floor in one range). When the umbrella `@deepseek-ai/dsh` publishes a
 * newer rc line (on any dist-tag), this script fails so the bump happens
 * BEFORE a publish, not after a broken install. The npm `alpha` release line
 * is covered by whichever pin can express it: an alpha peer segment, or the
 * dev pins, which sit on the line the test suite actually runs — a newer
 * registry alpha also fails the check (bump the pins, or document a
 * deliberate stay-behind).
 *
 * Network failure is not a failure here: an offline machine must not block
 * the gate, it only skips the check.
 */

import { readFile } from 'node:fs/promises'

const EXACT_PIN = /^0\.1\.(\d+)-(rc|alpha)\.(\d+)$/u
const RANGE_SEGMENT = /^>=0\.1\.(\d+)-(rc|alpha)\.(\d+) <0\.2\.0$/u
// semver prerelease precedence within one 0.1.x line: alpha < rc.
const RANK = { alpha: 0, rc: 1 }

/**
 * Parse one exact pin or one `>=lower <0.2.0` range segment into a bound.
 * @param text - one trimmed range segment.
 * @returns the bound, or null when the segment is not a supported pin.
 */
function parseBound(text) {
  const exact = EXACT_PIN.exec(text)
  if (exact !== null) {
    return { minor: Number(exact[1]), rank: exact[2], n: Number(exact[3]), exact: true }
  }
  const range = RANGE_SEGMENT.exec(text)
  if (range !== null) {
    return { minor: Number(range[1]), rank: range[2], n: Number(range[3]), exact: false }
  }
  return null
}

/**
 * Parse one dependency range: an exact pin or a `||` union of segments.
 * @param range - the dependency range string.
 * @returns every parseable bound (empty when the range carries none).
 */
function parseBounds(range) {
  const bounds = []
  for (const segment of String(range).split('||')) {
    const bound = parseBound(segment.trim())
    if (bound !== null) bounds.push(bound)
  }
  return bounds
}

/**
 * Collect the `@deepseek-ai/dsh*` pins of one dependency table.
 * @param deps - a package.json dependency table.
 * @returns one entry per dependency with at least one parseable bound.
 */
function collectPins(deps) {
  const pins = []
  for (const [name, range] of Object.entries(deps ?? {})) {
    if (!name.startsWith('@deepseek-ai/dsh')) continue
    const bounds = parseBounds(range)
    if (bounds.length > 0) pins.push({ name, bounds })
  }
  return pins
}

/** Render one bound as a version-ish label for diagnostics. */
function label(bound) {
  return `0.1.${bound.minor}-${bound.rank}.${bound.n}`
}

/**
 * Whether a peer bound admits `target` under npm's prerelease-tuple rule: a
 * `>=lower <0.2.0` range admits a prerelease only when a comparator shares
 * its `0.1.<minor>` tuple, so a lower minor never covers a prerelease of a
 * higher minor (the range still admits every plain release of a higher
 * minor, which is why an alpha segment must be added for an alpha line).
 * An exact pin admits only itself.
 * @param bound - one parsed peer bound.
 * @param target - the registry line to cover.
 * @returns true when the bound includes the target.
 */
function peerCovers(bound, target) {
  if (bound.exact) {
    return bound.minor === target.minor && bound.rank === target.rank && bound.n === target.n
  }
  return bound.minor === target.minor
    && (RANK[bound.rank] < RANK[target.rank]
      || (bound.rank === target.rank && bound.n <= target.n))
}

/**
 * Whether a dev pin sits on `target`'s line or a later one. Dev pins are the
 * line the suite runs; within one minor an rc pin outruns every alpha.
 * @param bound - one parsed dev bound.
 * @param target - the registry line to cover.
 * @returns true when the pin tracks the target or a later line.
 */
function devCovers(bound, target) {
  return bound.minor > target.minor
    || (bound.minor === target.minor
      && (RANK[bound.rank] > RANK[target.rank]
        || (bound.rank === target.rank && bound.n >= target.n)))
}

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const peerPins = collectPins(pkg.peerDependencies)
const devPins = collectPins(pkg.devDependencies)

if (peerPins.length === 0 && devPins.length === 0) {
  console.error('check-host-versions: no pinned @deepseek-ai/dsh-* peers or devDependencies found')
  process.exit(1)
}
if (peerPins.length === 0) {
  console.error('check-host-versions: no pinned @deepseek-ai/dsh-* peers found')
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

const published = Object.values(tags)
  .map(tag => parseBound(String(tag)))
  .filter(bound => bound !== null)

// Newest published rc line among the dist-tags (both 0.1.0-rc.N and 0.1.1-rc.N lines).
const newestRc = published
  .filter(bound => bound.rank === 'rc')
  .sort((left, right) => (left.minor - right.minor) || (left.n - right.n))
  .at(-1)

if (newestRc === undefined) {
  console.warn('check-host-versions: no parseable rc line on the registry; skipping')
  process.exit(0)
}

// A peer covers `newestRc` when one of its `||` segments admits it.
const stale = peerPins.filter(pin => !pin.bounds.some(bound => peerCovers(bound, newestRc)))

if (stale.length > 0) {
  console.error(
    `check-host-versions: @deepseek-ai/dsh newest rc line is ${label(newestRc)}, but the peers pin older: `
    + `${stale.map(pin => `${pin.name}@${pin.bounds.map(label).join(' || ')}`).join(', ')}. `
    + 'Bump the pins (or document a deliberate stay-behind) before publishing.',
  )
  process.exit(1)
}

console.log(`check-host-versions: peers cover the newest @deepseek-ai/dsh rc line (${label(newestRc)})`)

// The alpha release line is covered by an alpha peer segment or by the dev
// pins (which may sit on the rc line: within one minor an rc pin outranks
// every alpha). Fail when the registry alpha line outruns both.
const newestAlpha = published
  .filter(bound => bound.rank === 'alpha')
  .sort((left, right) => (left.minor - right.minor) || (left.n - right.n))
  .at(-1)

if (newestAlpha !== undefined) {
  const peerAlpha = peerPins.filter(pin => pin.bounds.some(bound => peerCovers(bound, newestAlpha)))
  const devAlpha = devPins.filter(pin => pin.bounds.some(bound => devCovers(bound, newestAlpha)))
  if (peerAlpha.length === 0 && devAlpha.length === 0) {
    console.error(
      `check-host-versions: @deepseek-ai/dsh newest alpha line is ${label(newestAlpha)}, but no peer segment or dev pin covers it. `
      + 'Bump the pins (or document a deliberate stay-behind) before publishing.',
    )
    process.exit(1)
  }
  const coveredBy = peerAlpha.length > 0
    ? `peer segments (${peerAlpha.map(pin => pin.name).join(', ')})`
    : `dev pins (${devAlpha.map(pin => pin.name).join(', ')})`
  console.log(`check-host-versions: ${coveredBy} cover the newest @deepseek-ai/dsh alpha line (${label(newestAlpha)})`)
}
