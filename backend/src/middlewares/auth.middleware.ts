import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../types/errors.js';
import { verifyAccessToken } from '../lib/jwt.js';

/**
 * Middleware аутентификации (docs/architecture.md §3).
 * Извлекает Bearer-токен, верифицирует подпись и срок,
 * помещает userId в req.userId для последующих слоёв.
 * Ошибки выбрасываются как AppError и преобразуются error-handler'ом.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    next(new AppError('UNAUTHORIZED', 'Отсутствует access-токен'));
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    req.userId = payload.userId;
    next();
  } catch (err) {
    next(err);
  }
}
