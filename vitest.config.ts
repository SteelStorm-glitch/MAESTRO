import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/server/src/**/*.test.ts', 'packages/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 15000,
  },
})
