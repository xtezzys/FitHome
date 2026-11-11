import jwt from 'jsonwebtoken';
import { AppError } from '../types/errors.js';
import { getEnv } from '../config/env.js';
import { ACCESS_TTL_SECONDS } from './tokens.js';

/**
 * Подпись и верификация JWT access-токенов (docs/architecture.md §5).
 * Секреты берутся из окружения через getEnv() — лениво, чтобы тесты
 * могли задать process.env до первого вызова.
 */

export interface AccessPayload {
  userId: number;
}

/** Подписывает access-токен на 15 минут с секретом JWT_ACCESS_SECRET. */
export function signAccessToken(userId: number): string {
  return jwt.sign({ type: 'access' }, getEnv().jwtAccessSecret, {
    subject: String(userId),
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

/**
 * Верифицирует access-токен и возвращает идентификатор пользователя.
 * При любой проблеме (просрочен, неверная подпись, чужой тип токена)
 * выбрасывает доменную ошибку UNAUTHORIZED — её преобразует error-handler.
 */
export function verifyAccessToken(token: string): AccessPayload {
  try {
    const payload = jwt.verify(token, getEnv().jwtAccessSecret);
    if (typeof payload === 'string' || payload.type !== 'access' || payload.sub === undefined) {
      throw new Error('Неожиданный формат payload');
    }
    return { userId: Number(payload.sub) };
  } catch {
    throw new AppError('UNAUTHORIZED', 'Недействительный или просроченный access-токен');
  }
}
