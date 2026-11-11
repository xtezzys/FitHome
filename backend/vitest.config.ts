import { defineConfig } from 'vitest/config';

/**
 * Конфигурация тестов backend (docs/testing.md §3, §5).
 * Тесты лежат рядом с тестируемым кодом в src/**\/__tests__/.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
});
