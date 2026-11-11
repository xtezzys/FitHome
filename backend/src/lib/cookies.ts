import type { Response } from 'express';
import { REFRESH_COOKIE, REFRESH_TTL_SECONDS } from './tokens.js';

/**
 * Управление httpOnly cookie refresh-токена (docs/api.md §2).
 * Secure выставляется только в production: локальная разработка идёт
 * по http://localhost, где Secure-cookie браузеры и так принимают.
 */
const baseOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/auth',
};

/** Устанавливает refresh-токен в httpOnly cookie. */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions,
    maxAge: REFRESH_TTL_SECONDS * 1000,
  });
}

/** Очищает refresh-cookie (docs/api.md §2: Max-Age=0). */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...baseOptions, maxAge: 0 });
}
