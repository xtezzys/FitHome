import { createHash, randomBytes } from 'node:crypto';

/**
 * Параметры и утилиты токенов (docs/architecture.md §5).
 * - Access-токен: JWT, 15 минут, передаётся в заголовке Authorization.
 * - Refresh-токен: криптостойкая случайная строка, 30 дней, httpOnly cookie.
 *   В БД хранится только SHA-256-хеш — утечка базы не раскрывает токены.
 */

/** Срок жизни access-токена, сек (15 минут). */
export const ACCESS_TTL_SECONDS = 15 * 60;

/** Срок жизни refresh-токена, сек (30 дней). */
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Имя httpOnly cookie с refresh-токеном (docs/api.md §2). */
export const REFRESH_COOKIE = 'refreshToken';

/** Стоимость bcrypt-хеширования паролей (docs/database.md §2.1). */
export const BCRYPT_ROUNDS = 10;

/** Генерирует криптостойкий opaque refresh-токен (base64url, 64 символа). */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

/** SHA-256-хеш токена для хранения в БД вместо открытого значения. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
