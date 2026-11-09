import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    passWithNoTests: true,
    include: ['test/drivers/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/drivers/**/*.ts'],
      exclude: ['src/drivers/**/*.d.ts', 'src/drivers/common/{config,driver,schema}.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
})
