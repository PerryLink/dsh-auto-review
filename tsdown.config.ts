/**
 * Build faces for `dsh-auto-review`. The node half (src/index.ts, the
 * answerer plugin, plus the invariant and panel companions) is the host
 * Loader entry; the browser half (src/client/index.ts) is the client bundle
 * the client-modules node half serves under `/plugins/dsh-auto-review/client.js`.
 *
 * The browser half follows the shell's client-bundle handshake exactly: a
 * CJS bundle wrapped in `window.__ModuleLoader__.load({ id, factory })`,
 * with the shell's platform modules left external (the factory's `require`
 * answers them from the frozen module table) and every other dependency
 * inlined.
 */

import { defineConfig } from 'tsdown'

/** Plugin id: the package name, the graph row id, and the stamped bundle id must all match. */
const PLUGIN_ID = 'dsh-auto-review'

/**
 * Module specifiers the shell shares into the frozen browser module table
 * (packages/client/web/src/platform.ts). Any value import outside this list
 * must be inlined.
 */
const PLATFORM_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

export default defineConfig([
  {
    name: PLUGIN_ID,
    entry: { index: 'src/index.ts', invariant: 'src/invariant.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    // ESM output under a "type": "module" package must land on .js, not .mjs.
    fixedExtension: false,
    deps: {
      // Every @deepseek-ai peer resolves at runtime from the host profile.
      neverBundle: [/^node:/, /^@deepseek-ai\//],
      // zod + yaml are non-peer dependencies: bundle them so the node faces
      // stay self-contained when a profile resolves the package outside
      // pnpm's tree.
      alwaysBundle: ['zod', 'yaml'],
    },
  },
  {
    name: `${PLUGIN_ID}/eval`,
    entry: { eval: 'src/eval/index.ts', 'eval-cli': 'src/eval/cli.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    fixedExtension: false,
    deps: {
      // The composition rows and every @deepseek-ai runtime resolve from the
      // package's own node_modules (exact-pinned dependencies).
      neverBundle: [/^node:/, /^@deepseek-ai\//],
      alwaysBundle: ['zod', 'yaml'],
    },
  },
  {
    name: `${PLUGIN_ID}/mcp`,
    entry: { mcp: 'src/mcp/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    fixedExtension: false,
    deps: {
      // The standalone reviewer reuses src/cache.ts (node:crypto) and
      // src/config.ts (schemastery, an existing peer) — no new dependencies.
      neverBundle: [/^node:/, /^@deepseek-ai\//],
      alwaysBundle: ['zod', 'yaml'],
    },
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: [...PLATFORM_EXTERNALS],
      alwaysBundle: (id: string): boolean | undefined => (PLATFORM_EXTERNALS.includes(id) ? undefined : true),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
