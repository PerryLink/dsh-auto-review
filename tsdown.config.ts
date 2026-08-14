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
 * (packages/client/web/src/platform.ts) plus the runtime store exemption
 * (`@deepseek-ai/dsh-client-runtime/client`). Any value import outside this
 * list must be inlined.
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
  '@deepseek-ai/dsh-client-runtime/client',
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
    external: [/^node:/, /^@deepseek-ai\//],
    // zod is a non-peer dependency: bundle it so the host half stays
    // self-contained when a profile resolves the package outside pnpm's tree.
    noExternal: ['zod'],
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
    external: [...PLATFORM_EXTERNALS],
    noExternal: (id: string) => (PLATFORM_EXTERNALS.includes(id) ? undefined : true),
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
