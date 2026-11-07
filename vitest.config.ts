import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/ui/**/*.test.tsx', 'tests/audit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000
  }
})
