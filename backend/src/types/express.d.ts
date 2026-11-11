/**
 * Расширение типов Express: идентификатор пользователя,
 * добавляемый middleware аутентификации (middlewares/auth.middleware.ts).
 */
declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export {};
