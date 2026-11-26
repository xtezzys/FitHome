/**
 * Типы статистики — зеркалят DTO backend Stage 4 (docs/api.md §6).
 * byPlace всегда содержит все три места; series сгруппированы по snapshot-метрике.
 */

import type { Metric, Place } from './exercise';

/** Агрегаты одного среза (день/неделя). */
export interface StatsBucket {
  workoutsCount: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
}

/** Срез по дню: date — YYYY-MM-DD UTC. */
export interface StatsDayBucket extends StatsBucket {
  date: string;
}

/** Срез по неделе: weekStart — понедельник, YYYY-MM-DD UTC. */
export interface StatsWeekBucket extends StatsBucket {
  weekStart: string;
}

/** Количество тренировок по местам; отсутствующие места — 0. */
export type StatsByPlace = Record<Place, number>;

/** GET /api/stats/summary. */
export interface StatsSummary {
  workoutsCount: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  byPlace: StatsByPlace;
  byDay: StatsDayBucket[];
  byWeek: StatsWeekBucket[];
}

/** Параметры summary: from/to — YYYY-MM-DD (UTC), to включительно. */
export interface StatsSummaryParams {
  from?: string;
  to?: string;
}

/**
 * Точка истории упражнения. Значения соответствуют snapshot-метрике серии:
 * reps/reps_weight — totalReps/bestReps; reps_weight — totalVolume/bestWeight;
 * time — только totalSets/bestDuration.
 */
export interface ExerciseStatsPoint {
  workoutId: number;
  startedAt: string;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  bestReps: number | null;
  bestWeight: number | null;
  bestDuration: number | null;
}

/** Серия одной snapshot-метрики; разные метрики не смешиваются. */
export interface ExerciseStatsSeries {
  metric: Metric;
  points: ExerciseStatsPoint[];
}

/** GET /api/stats/exercises/:exerciseId. */
export interface ExerciseStats {
  exerciseId: number;
  exerciseName: string;
  currentMetric: Metric;
  metricChanged: boolean;
  series: ExerciseStatsSeries[];
}

/** Параметры истории упражнения: limit 1..100, default 50. */
export interface ExerciseStatsParams {
  from?: string;
  to?: string;
  limit?: number;
}
