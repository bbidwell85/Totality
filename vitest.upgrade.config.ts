import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/database-upgrade-real.test.ts'],
    testTimeout: 30_000,
  },
})
