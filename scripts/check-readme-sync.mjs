// Five-language README sync gate: every README must carry the same number of
// `## ` sections as the English source, state the install command, and contain
// every configuration-table key. Section headings may be translated; the
// English file is the source of truth.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const FILES = ['README.md', 'README.zh.md', 'README.es.md', 'README.pt.md', 'README.hi.md']
const INSTALL_COMMAND = 'dsh plugin --profile web add dsh-auto-review'

const failures = []
const read = (file) => {
  const filePath = path.join(root, file)
  if (!existsSync(filePath)) {
    failures.push(`${file} is missing`)
    return ''
  }
  return readFileSync(filePath, 'utf8')
}

const sectionCount = (text) => (text.match(/^## /gmu) ?? []).length

// Configuration-table keys: every backtick-quoted token in the first cell of
// each row under the "## Configuration" section (until the next `## ` heading).
const configKeysOf = (text) => {
  const lines = text.split(/\r?\n/u)
  const start = lines.findIndex(line => /^##\s+Configuration\s*$/u.test(line))
  if (start === -1) return []
  const end = lines.findIndex((line, index) => index > start && /^##\s+/u.test(line))
  const section = lines.slice(start, end === -1 ? undefined : end)
  const keys = []
  for (const line of section) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map(cell => cell.trim())
    const key = cells[1]
    if (key === undefined || key === '' || key === 'Key' || /^-+$/u.test(key)) continue
    const tokens = [...key.matchAll(/`([^`]+)`/gu)].map(match => match[1])
    if (tokens.length > 0) keys.push(...tokens)
    else keys.push(key)
  }
  return keys
}

const contents = FILES.map(read)
const source = contents[0]
if (source === undefined) process.exit(1)
const expectedSections = sectionCount(source)
const expectedKeys = configKeysOf(source)

for (let index = 1; index < FILES.length; index++) {
  const file = FILES[index]
  const text = contents[index]
  if (text === undefined || text === '') continue
  if (sectionCount(text) !== expectedSections) {
    failures.push(`${file}: ${sectionCount(text)} '## ' sections, expected ${expectedSections}`)
  }
  if (!text.includes(INSTALL_COMMAND)) {
    failures.push(`${file}: missing the install command`)
  }
  for (const key of expectedKeys) {
    if (!text.includes(`\`${key}\``)) failures.push(`${file}: missing the config key \`${key}\``)
  }
}

if (failures.length > 0) {
  console.error('readme-sync failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`readme-sync: all ${FILES.length} READMEs share ${expectedSections} sections, the install command, and ${expectedKeys.length} config keys`)
