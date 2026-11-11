import { Router } from 'express';

/**
 * Корневой роутер /api.
 * На этапах 2–5 здесь регистрируются auth, exercises, programs,
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
