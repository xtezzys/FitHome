import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Доступ к данным статистики (docs/api.md §6, этап 4.4).
 *
 * Только Prisma ORM — raw SQL запрещён (docs/database.md §9), поэтому
 * группировки по дням/неделям и правила метрик выполняет stats.service.
 * Здесь — выборка минимального набора полей:
 * - только completed-тренировки владельца;
 * - skipped результаты и подходы исключены в where;
 * - to включительно: сервис передаёт toExclusive = to + 1 день (UTC).
 */

export interface StatsDateRange {
  /** Нижняя граница включительно. */
  from?: Date;
  /** Верхняя граница исключительно (to + 1 день UTC). */
  toExclusive?: Date;
}

const summaryWorkoutSelect = {
  id: true,
  place: true,
  startedAt: true,
  results: {
    where: { skipped: false },
    select: {
      exerciseMetric: true,
      sets: {
        where: { skipped: false },
        select: { reps: true, weight: true, duration: true },
      },
    },
  },
} satisfies Prisma.WorkoutSelect;

export type SummaryWorkoutRow = Prisma.WorkoutGetPayload<{ select: typeof summaryWorkoutSelect }>;

const exerciseHistorySelect = {
  id: true,
  workoutId: true,
  exerciseMetric: true,
  workout: { select: { startedAt: true, place: true } },
  sets: {
    where: { skipped: false },
    select: { order: true, reps: true, weight: true, duration: true },
  },
} satisfies Prisma.WorkoutResultSelect;

export type ExerciseHistoryRow = Prisma.WorkoutResultGetPayload<{
  select: typeof exerciseHistorySelect;
}>;

function rangeFilter(range?: StatsDateRange): Prisma.DateTimeFilter | undefined {
  if (range?.from === undefined && range?.toExclusive === undefined) {
    return undefined;
  }
  const filter: Prisma.DateTimeFilter = {};
  if (range?.from !== undefined) filter.gte = range.from;
  if (range?.toExclusive !== undefined) filter.lt = range.toExclusive;
  return filter;
}

/** Завершённые тренировки владельца за период с не-skipped результатами/подходами. */
export function findSummaryWorkouts(
  userId: number,
  range?: StatsDateRange,
): Promise<SummaryWorkoutRow[]> {
  const startedAt = rangeFilter(range);
  return prisma.workout.findMany({
    where: { userId, status: 'completed', ...(startedAt ? { startedAt } : {}) },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    select: summaryWorkoutSelect,
  });
}

/**
 * История одного упражнения: не-skipped результаты и подходы из completed
 * тренировок владельца. Берутся последние `limit` точек (desc); сервис
 * разворачивает их в хронологический порядок.
 */
export function findExerciseHistory(
  userId: number,
  exerciseId: number,
  range: StatsDateRange | undefined,
  limit: number,
): Promise<ExerciseHistoryRow[]> {
  const startedAt = rangeFilter(range);
  return prisma.workoutResult.findMany({
    where: {
      exerciseId,
      skipped: false,
      workout: {
        is: {
          userId,
          status: 'completed',
          ...(startedAt ? { startedAt } : {}),
        },
      },
    },
    orderBy: [{ workout: { startedAt: 'desc' } }, { id: 'desc' }],
    take: limit,
    select: exerciseHistorySelect,
  });
}
