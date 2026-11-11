import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../types/errors.js';

/**
 * Единая обработка ошибок (docs/architecture.md §3, формат — docs/api.md §1).
 */

/** 404 для маршрутов без обработчика. */
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Маршрут не найден' },
  });
}

/** Преобразует доменные ошибки в HTTP-ответ единого формата. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
    return;
  }

  console.error('Необработанная ошибка:', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' },
  });
}
