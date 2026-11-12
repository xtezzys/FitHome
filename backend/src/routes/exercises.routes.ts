import { Router } from 'express';
import * as exerciseController from '../controllers/exercise.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

/**
 * Маршруты /api/exercises (docs/api.md §3).
 * Все эндпоинты требуют JWT (requireAuth) — включая чтение каталога.
 */
export const exercisesRouter = Router();

exercisesRouter.use(requireAuth);

exercisesRouter.get('/', exerciseController.list);
exercisesRouter.post('/', exerciseController.create);
exercisesRouter.get('/:id', exerciseController.get);
exercisesRouter.put('/:id', exerciseController.update);
exercisesRouter.delete('/:id', exerciseController.remove);
