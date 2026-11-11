import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import * as userController from '../controllers/user.controller.js';
import { requireAuth } from '../middlewares/auth.middleware.js';

/**
 * Корневой роутер /api.
 * На этапах 3–5 здесь регистрируются exercises, programs,
 * workouts, stats, settings — контракты в docs/api.md.
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
