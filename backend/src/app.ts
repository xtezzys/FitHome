import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { getEnv } from './config/env.js';

/**
 * Сборка Express-приложения без прослушивания порта (docs/architecture.md §2).
 * Прослушивание — в server.ts; это позволяет тестировать приложение
 * на свободном порту без реального запуска сервера.
 */
export function createApp(): Express {
  const app = express();

  // CORS с credentials: SPA (Vite, :5173) и API (:4000) — разные origin.
  // Без этого браузер не отправит/не сохранит httpOnly refresh-cookie (docs/api.md §2).
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', getEnv().corsOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json());
  // Разбор httpOnly cookie refresh-токена (docs/api.md §2)
  app.use(cookieParser());

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
