import { Router } from 'express';
import * as statsController from '../controllers/stats.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

/**
 * Маршруты /api/stats (docs/api.md §6, этап 4.4).
 * Все эндпоинты требуют JWT; доступ ограничен тренировками владельца в service.
 */
export const statsRouter = Router();

statsRouter.use(requireAuth);

statsRouter.get('/summary', statsController.summary);
statsRouter.get('/exercises/:exerciseId', statsController.exercise);
