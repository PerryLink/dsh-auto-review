import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  outDir: 'lib',
  outExtensions: () => ({ js: '.js' }),
  // Everything under @deepseek-ai/* is provided by the host at runtime.
  deps: { neverBundle: [/^@deepseek-ai\//] },
})
