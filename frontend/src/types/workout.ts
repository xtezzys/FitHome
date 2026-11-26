/**
 * Типы тренировок — зеркалят DTO backend Stage 4 (docs/api.md §5).
 * exerciseId/programExerciseId могут быть null (SetNull после удаления
 * упражнения/элемента программы), weight — число или null.
 */

import type { Metric, Place } from './exercise';

export type WorkoutStatus = 'in_progress' | 'completed' | 'cancelled';

/** Подход в ответах API. */
export interface WorkoutSet {
  id: number;
  order: number;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  skipped: boolean;
}

/** Результат упражнения в тренировке: снапшоты названия и метрики. */
export interface WorkoutResult {
  id: number;
  exerciseId: number | null;
  programExerciseId: number | null;
  exerciseName: string;
  exerciseMetric: Metric;
  order: number;
  skipped: boolean;
  notes: string | null;
  sets: WorkoutSet[];
}

/** Полная тренировка с результатами и подходами. */
export interface Workout {
  id: number;
  userId: number;
  programId: number | null;
  programName: string | null;
  place: Place;
  status: WorkoutStatus;
  revision: number;
  startedAt: string;
  completedAt: string | null;
  durationSec: number | null;
  notes: string | null;
  results: WorkoutResult[];
}

/** Элемент истории: только завершённые, без результатов и revision. */
export interface WorkoutListItem {
  id: number;
  programId: number | null;
  programName: string | null;
  place: Place;
  startedAt: string;
  durationSec: number | null;
  notes: string | null;
  exercisesCount: number;
  totalSets: number;
}

/** Параметры истории: from/to — YYYY-MM-DD (UTC), to включительно. */
export interface WorkoutListParams {
  page?: number;
  limit?: number;
  place?: Place;
  from?: string;
  to?: string;
}

/** POST /api/workouts — без programId создаётся свободная тренировка. */
export interface StartWorkoutInput {
  place: Place;
  programId?: number;
}

/** Подход в запросе полной замены; заполненность полей зависит от метрики. */
export interface SaveWorkoutSetInput {
  order: number;
  reps?: number | null;
  weight?: number | null;
  duration?: number | null;
  skipped?: boolean;
}

/**
 * Результат в запросе полной замены. Ровно один идентификатор:
 * programExerciseId — программная тренировка, exerciseId — свободная.
 */
export interface SaveWorkoutResultInput {
  order: number;
  skipped?: boolean;
  notes?: string | null;
  sets: SaveWorkoutSetInput[];
  programExerciseId?: number;
  exerciseId?: number;
}

/** PUT /api/workouts/:id/results — revision для CAS, полная замена состава. */
export interface SaveWorkoutResultsInput {
  revision: number;
  results: SaveWorkoutResultInput[];
}
