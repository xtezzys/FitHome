import { Router } from 'express';
import * as programController from '../controllers/program.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

/**
 * Маршруты /api/programs (docs/api.md §4).
 * Все эндпоинты требуют JWT. PUT .../exercises/order регистрируется
 * ДО PUT .../exercises/:programExerciseId (иначе "order" попадёт в :programExerciseId).
 */
export const programsRouter = Router();

programsRouter.use(requireAuth);

programsRouter.get('/', programController.list);
programsRouter.post('/', programController.create);
programsRouter.get('/:id', programController.get);
programsRouter.put('/:id', programController.update);
programsRouter.delete('/:id', programController.remove);
programsRouter.post('/:id/copy', programController.copy);
programsRouter.post('/:id/exercises', programController.addExercise);
programsRouter.put('/:id/exercises/order', programController.reorderExercises);
programsRouter.put('/:id/exercises/:programExerciseId', programController.updateExercise);
programsRouter.delete('/:id/exercises/:programExerciseId', programController.removeExercise);
