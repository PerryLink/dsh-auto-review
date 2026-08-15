import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.spec.ts'],
          exclude: ['test/client*.spec.ts'],
        },
      },
      {
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['test/client*.spec.ts'],
        },
      },
    ],
  },
})
