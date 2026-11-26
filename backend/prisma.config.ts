import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Конфигурация Prisma CLI (Prisma 6.19+): заменяет deprecated-секцию
 * "prisma" в package.json. Загрузка переменных окружения (.env) —
 * вручную через dotenv, так как при наличии prisma.config.ts CLI
 * не подхватывает .env автоматически.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
