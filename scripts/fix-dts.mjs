// fix-dts.mjs — rewrite `.ts` relative specifiers to `.js` in emitted
// declarations (lib/types/**/*.d.ts). TypeScript 5.9's
// `rewriteRelativeImportExtensions` rewrites the JS emit but NOT the
// declaration emit (verified empirically), so declaration consumers under
// NodeNext resolution would fail on `.ts` specifiers. Node builtins only:
// this runs inside the git-install `prepare` with production deps alone.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'types')
if (!existsSync(root)) {
  console.log('fix-dts: no lib/types to rewrite')
  process.exit(0)
}

let files = 0
let rewrites = 0
const rewrite = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      rewrite(full)
    } else if (entry.name.endsWith('.d.ts')) {
      const text = readFileSync(full, 'utf8')
      const next = text.replace(
        /((?:from\s+|import\()['"])(\.\.?\/[^'"]+?)(\.ts|\.tsx)(['"])/gu,
        (match, prefix, specifier, ext, quote) => `${prefix}${specifier}.js${quote}`,
      )
      if (next !== text) {
        writeFileSync(full, next)
        files += 1
        rewrites += (text.match(/(?:from\s+|import\()['"]\.\.?\/[^'"]+?\.tsx?['"]/gu) ?? []).length
      }
    }
  }
}
rewrite(root)
console.log(`fix-dts: ${files} file(s), ${rewrites} specifier(s) rewritten to .js`)
