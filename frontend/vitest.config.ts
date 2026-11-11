import { defineConfig } from 'vitest/config';

/**
 * Конфигурация тестов frontend (docs/testing.md §4, §5).
 * jsdom — для проверки рендера React-компонентов; Testing Library
 * подключена на этапе 2. setupTests — матчеры jest-dom.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.tsx', 'src/**/__tests__/**/*.test.ts'],
    setupFiles: ['src/setupTests.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
});
