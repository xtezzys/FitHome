import { defineConfig } from 'vitest/config';

/**
 * Конфигурация тестов backend (docs/testing.md §3, §5).
 * Тесты лежат рядом с тестируемым кодом в src/**\/__tests__/.
 * Тестовые секреты JWT задаются через env — реальные секреты
 * из .env в тесты не попадают.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    env: {
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
      DATABASE_URL: 'file:./test.db',
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
});
