import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import * as userController from '../controllers/user.controller.js';
import { exercisesRouter } from './exercises.routes.js';
import { programsRouter } from './programs.routes.js';
import { workoutsRouter } from './workouts.routes.js';
import { statsRouter } from './stats.routes.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

/**
 * Корневой роутер /api.
 * На этапах 4–5 здесь регистрируются workouts, stats, settings —
 * контракты в docs/api.md.
 */
export const apiRouter = Router();

// GET /api/health — здоровье сервиса (docs/api.md §8)
apiRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// /api/auth — авторизация (docs/api.md §2): register и login — публичные,
// refresh — по httpOnly cookie, logout — публичный (идемпотентный),
// me — по Bearer access-току.
const authRouter = Router();

authRouter.post('/register', authController.register);
authRouter.post('/login', authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', requireAuth, userController.getMe);
authRouter.put('/me', requireAuth, userController.updateMe);

apiRouter.use('/auth', authRouter);

// /api/exercises — каталог упражнений (docs/api.md §3, этап 3)
apiRouter.use('/exercises', exercisesRouter);

// /api/programs — программы и состав (docs/api.md §4, этап 3)
apiRouter.use('/programs', programsRouter);

// /api/workouts — тренировки, автосохранение, история (docs/api.md §5, этап 4)
apiRouter.use('/workouts', workoutsRouter);

// /api/stats — сводка и история упражнения (docs/api.md §6, этап 4.4)
apiRouter.use('/stats', statsRouter);
