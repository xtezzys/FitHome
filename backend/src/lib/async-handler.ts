import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Обёртка для async-контроллеров: Express 4 не перехватывает отклонённые
 * промисы — передаём ошибку в error-chain явно.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
