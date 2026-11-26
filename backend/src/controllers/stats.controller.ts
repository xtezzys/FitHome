import type { Request, Response } from 'express';
import * as statsService from '../services/stats.service.js';
import {
  parseExerciseStatsQuery,
  parseId,
  parseStatsSummaryQuery,
} from '../middlewares/validate.js';
import { asyncHandler } from '../lib/async-handler.js';

/**
 * HTTP-обработчики статистики (docs/api.md §6, этап 4.4).
 * userId берётся только из access-токена (requireAuth); валидация входа —
 * на границе контроллеров; правила расчётов — в stats.service.
 */

/** GET /api/stats/summary — 200 + сводка завершённых тренировок за период. */
export const summary = asyncHandler(async (req: Request, res: Response) => {
  const query = parseStatsSummaryQuery(req.query);
  const result = await statsService.getSummary(req.userId as number, query);
  res.status(200).json(result);
});

/** GET /api/stats/exercises/:exerciseId — 200 + история упражнения по метрикам. */
export const exercise = asyncHandler(async (req: Request, res: Response) => {
  const exerciseId = parseId(req.params.exerciseId);
  const query = parseExerciseStatsQuery(req.query);
  const result = await statsService.getExerciseStats(req.userId as number, exerciseId, query);
  res.status(200).json(result);
});
