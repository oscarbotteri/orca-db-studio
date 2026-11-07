import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['test/drivers/**/*.test.ts'],
  },
})
