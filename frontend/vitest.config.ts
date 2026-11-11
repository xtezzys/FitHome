import { defineConfig } from 'vitest/config';

/**
 * Конфигурация тестов frontend (docs/testing.md §4, §5).
 * jsdom — для проверки рендера React-компонентов; Testing Library
 * подключается на этапе 2.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.tsx', 'src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
});
