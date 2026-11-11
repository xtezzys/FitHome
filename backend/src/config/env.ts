import 'dotenv/config';

/**
 * Конфигурация окружения backend.
 *
 * Загружается один раз в server.ts перед созданием PrismaClient:
 * приложение не поднимается с неполной конфигурацией.
 * Перечень переменных согласован с docs/architecture.md §7 и backend/.env.example.
 */

export interface Env {
  port: number;
  databaseUrl: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  corsOrigin: string;
}

/** Читает и валидирует обязательные переменные окружения. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const databaseUrl = source.DATABASE_URL;
  const jwtAccessSecret = source.JWT_ACCESS_SECRET;
  const jwtRefreshSecret = source.JWT_REFRESH_SECRET;

  const missing = Object.entries({ databaseUrl, jwtAccessSecret, jwtRefreshSecret })
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Отсутствуют обязательные переменные окружения: ${missing.join(', ')}. ` +
        `Скопируйте backend/.env.example в backend/.env и заполните значения.`,
    );
  }

  return {
    port: Number(source.PORT ?? 4000),
    databaseUrl: databaseUrl as string,
    jwtAccessSecret: jwtAccessSecret as string,
    jwtRefreshSecret: jwtRefreshSecret as string,
    corsOrigin: source.CORS_ORIGIN ?? 'http://localhost:5173',
  };
}

let cachedEnv: Env | null = null;

/**
 * Ленивое чтение окружения с кэшированием: позволяет тестам задать
 * process.env до первого обращения, а модулям — не требовать env на импорте.
 */
export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = loadEnv();
  }
  return cachedEnv;
}
