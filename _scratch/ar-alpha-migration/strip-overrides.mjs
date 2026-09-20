// Test-only: strip the inert override block + stale comment from a copy's
// pnpm-workspace.yaml, so the migration can verify whether the current
// dual-line pins (dev 0.1.3-alpha.2 / deps 0.1.2-rc.1) still install cleanly
// without the historical overrides. Usage: node strip-overrides.mjs <repo-dir>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2]
if (!base) throw new Error('usage: node strip-overrides.mjs <repo-dir>')
const path = join(base, 'pnpm-workspace.yaml')
let text = readFileSync(path, 'utf8')

const start = text.indexOf('# The dev pins run')
if (start === -1) throw new Error('stale comment block not found')
const end = text.indexOf("verifyDepsBeforeRun:", start)
if (end === -1) throw new Error('trailing key not found')

const replacement = `# Dual-line pins: the dev pins run the published \`0.1.3-alpha.2\` line while the
# runtime \`dependencies\` keep the published \`0.1.2-rc.1\` line. Verified
# 2026-09-08: pnpm 11.7.0 resolves the two prerelease lines side by side
# without range-merge conflicts, so no override block is needed (the
# historical \`^0.1.2-alpha.2\` overrides solved an older alpha.2-dev /
# rc.2-deps pairing and match nothing on the current lines).
`
text = text.slice(0, start) + replacement + text.slice(end)
writeFileSync(path, text)
console.log('stripped overrides from', path)
