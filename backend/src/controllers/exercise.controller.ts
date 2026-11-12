import type { Request, Response } from 'express';
import * as exerciseService from '../services/exercise.service.js';
import {
  parseCreateExerciseDto,
  parseExerciseListQuery,
  parseId,
  parseUpdateExerciseDto,
} from '../middlewares/validate.js';
import { asyncHandler } from '../lib/async-handler.js';

/**
 * HTTP-обработчики каталога упражнений (docs/api.md §3).
 * userId берётся из access-токена (requireAuth); валидация входа —
 * на границе контроллеров, бизнес-правила — в services.
 */

/** GET /api/exercises — 200 + { data, meta }. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = parseExerciseListQuery(req.query);
  const result = await exerciseService.listExercises(req.userId as number, query);
  res.status(200).json(result);
});

/** GET /api/exercises/:id — 200 + упражнение. */
export const get = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const exercise = await exerciseService.getExercise(req.userId as number, id);
  res.status(200).json(exercise);
});

/** POST /api/exercises — 201 + созданное персональное упражнение. */
export const create = asyncHandler(async (req: Request, res: Response) => {
  const dto = parseCreateExerciseDto(req.body);
  const exercise = await exerciseService.createExercise(req.userId as number, dto);
  res.status(201).json(exercise);
});

/** PUT /api/exercises/:id — 200 + обновлённое упражнение. */
export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const dto = parseUpdateExerciseDto(req.body);
  const exercise = await exerciseService.updateExercise(req.userId as number, id, dto);
  res.status(200).json(exercise);
});

/** DELETE /api/exercises/:id — 204. */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  await exerciseService.deleteExercise(req.userId as number, id);
  res.status(204).send();
});
