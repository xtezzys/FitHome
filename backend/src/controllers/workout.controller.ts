import type { Request, Response } from 'express';
import * as workoutService from '../services/workout.service.js';
import {
  parseCompleteWorkoutDto,
  parseId,
  parseSaveResultsDto,
  parseStartWorkoutDto,
  parseUpdateWorkoutNotesDto,
  parseWorkoutListQuery,
} from '../middlewares/validate.js';
import { asyncHandler } from '../lib/async-handler.js';

/**
 * HTTP-обработчики тренировок (docs/api.md §5, этап 4).
 * userId берётся из access-токена (requireAuth); валидация входа — на границе
 * контроллеров; владение, статусы и CAS по revision — в workout.service.
 */

/** POST /api/workouts — 201 + тренировка (программная или свободная). */
export const start = asyncHandler(async (req: Request, res: Response) => {
  const dto = parseStartWorkoutDto(req.body);
  const workout = await workoutService.startWorkout(req.userId as number, dto);
  res.status(201).json(workout);
});

/** GET /api/workouts/active — 200 + активная тренировка; нет — 404. */
export const getActive = asyncHandler(async (req: Request, res: Response) => {
  const workout = await workoutService.getActiveWorkout(req.userId as number);
  res.status(200).json(workout);
});

/** GET /api/workouts — 200 + { data, meta } истории завершённых тренировок. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = parseWorkoutListQuery(req.query);
  const result = await workoutService.listWorkoutHistory(req.userId as number, query);
  res.status(200).json(result);
});

/** GET /api/workouts/:id — 200 + детали тренировки с результатами. */
export const get = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const workout = await workoutService.getWorkout(req.userId as number, id);
  res.status(200).json(workout);
});

/** PUT /api/workouts/:id/results — 200 + тренировка после полной замены. */
export const saveResults = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const dto = parseSaveResultsDto(req.body);
  const workout = await workoutService.saveWorkoutResults(req.userId as number, id, dto);
  res.status(200).json(workout);
});

/** PUT /api/workouts/:id — 200 + тренировка с обновлёнными заметками. */
export const updateNotes = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const dto = parseUpdateWorkoutNotesDto(req.body);
  const workout = await workoutService.updateWorkoutNotes(req.userId as number, id, dto);
  res.status(200).json(workout);
});

/** POST /api/workouts/:id/complete — 200 + завершённая тренировка. */
export const complete = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const dto = parseCompleteWorkoutDto(req.body);
  const workout = await workoutService.completeWorkout(req.userId as number, id, dto);
  res.status(200).json(workout);
});

/** POST /api/workouts/:id/cancel — 200 + отменённая тренировка (идемпотентно). */
export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  const workout = await workoutService.cancelWorkout(req.userId as number, id);
  res.status(200).json(workout);
});

/** DELETE /api/workouts/:id — 204. */
export const remove = asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id);
  await workoutService.deleteWorkout(req.userId as number, id);
  res.status(204).send();
});
