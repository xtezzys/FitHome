import express, { type Express } from 'express';
import { apiRouter } from './routes/index.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';

/**
 * Сборка Express-приложения без прослушивания порта (docs/architecture.md §2).
 * Прослушивание — в server.ts; это позволяет тестировать приложение
 * на свободном порту без реального запуска сервера.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json());

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
