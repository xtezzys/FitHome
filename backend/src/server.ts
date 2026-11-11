import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

/**
 * Точка входа API-сервера (docs/architecture.md §2).
 * Конфигурация валидируется до старта — приложение не поднимается
 * с некорректным окружением.
 */
function bootstrap(): void {
  const env = loadEnv();
  const app = createApp();

  app.listen(env.port, () => {
    console.log(`FitHome API запущен: http://localhost:${env.port}/api`);
  });
}

bootstrap();
