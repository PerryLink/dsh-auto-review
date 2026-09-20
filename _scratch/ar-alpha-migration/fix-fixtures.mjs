// Apply the header-version fixture fixes to a repo tree (temp copy or real repo).
// Dual-line: `SESSION_FORMAT_VERSION` is 0 on 0.1.2-rc.1 and 2 on 0.1.3-alpha.2,
// so fixtures compiled against either pinned line typecheck AND run.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const base = process.argv[2]
if (!base) throw new Error('usage: node fix-fixtures.mjs <repo-dir>')

const edits = [
  {
    file: 'test/reviewer.spec.ts',
    pairs: [
      ["import { Session } from '@deepseek-ai/dsh-session'\nimport { SessionId } from '@deepseek-ai/dsh-session'",
       "import { Session, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'\nimport { SessionId } from '@deepseek-ai/dsh-session'"],
    ],
    replaceAll: [['version: 0', 'version: SESSION_FORMAT_VERSION']],
  },
  {
    file: 'test/isolation.spec.ts',
    pairs: [
      ["import { Session, SessionId } from '@deepseek-ai/dsh-session'",
       "import { Session, SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'"],
    ],
    replaceAll: [['version: 0', 'version: SESSION_FORMAT_VERSION']],
  },
  {
    file: 'test/eval/runner.spec.ts',
    pairs: [
      ["import { SessionId } from '@deepseek-ai/dsh-session'",
       "import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'"],
      ["header: { version: 0, id: SessionId('eval-test'), createdAt: Date.now(), cwd: 'x', delegationDepth: 0 } as SessionHeader,",
       "header: { version: SESSION_FORMAT_VERSION, id: SessionId('eval-test'), createdAt: Date.now(), cwd: 'x', delegationDepth: 0, isSeeded: false } as SessionHeader,"],
    ],
    replaceAll: [],
  },
]

for (const { file, pairs, replaceAll } of edits) {
  const path = join(base, file)
  let text = readFileSync(path, 'utf8')
  for (const [from, to] of pairs) {
    if (!text.includes(from)) throw new Error(`${file}: pattern not found: ${from.slice(0, 80)}`)
    text = text.replaceAll(from, to)
  }
  for (const [from, to] of replaceAll) {
    const count = text.split(from).length - 1
    if (count === 0) throw new Error(`${file}: no occurrence of ${from}`)
    text = text.replaceAll(from, to)
    console.log(`${file}: replaced ${count}x ${from}`)
  }
  writeFileSync(path, text)
  console.log(`edited ${file}`)
}
console.log('done')
