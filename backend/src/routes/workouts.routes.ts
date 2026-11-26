import { Router } from 'express';
import * as workoutController from '../controllers/workout.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

/**
 * Маршруты /api/workouts (docs/api.md §5, этап 4).
 * Все эндпоинты требуют JWT. GET /active регистрируется ДО GET /:id,
 * иначе "active" попадёт в параметр :id.
 */
export const workoutsRouter = Router();

workoutsRouter.use(requireAuth);

workoutsRouter.get('/active', workoutController.getActive);
workoutsRouter.get('/', workoutController.list);
workoutsRouter.post('/', workoutController.start);
workoutsRouter.get('/:id', workoutController.get);
workoutsRouter.put('/:id/results', workoutController.saveResults);
workoutsRouter.put('/:id', workoutController.updateNotes);
workoutsRouter.post('/:id/complete', workoutController.complete);
workoutsRouter.post('/:id/cancel', workoutController.cancel);
workoutsRouter.delete('/:id', workoutController.remove);
