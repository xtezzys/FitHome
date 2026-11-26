import type {
  ExerciseStatsDto,
  ExerciseStatsPointDto,
  ExerciseStatsQuery,
  ExerciseStatsSeriesDto,
  StatsBucketDto,
  StatsByPlaceDto,
  StatsDayBucketDto,
  StatsSummaryDto,
  StatsSummaryQuery,
  StatsWeekBucketDto,
} from '../types/dto.js';
import type {
  ExerciseHistoryRow,
  StatsDateRange,
  SummaryWorkoutRow,
} from '../repositories/stats.repository.js';
import { AppError } from '../types/errors.js';
import * as exerciseRepo from '../repositories/exercise.repository.js';
import * as statsRepo from '../repositories/stats.repository.js';

/**
 * Бизнес-логика статистики (docs/api.md §6, этап 4.4).
 *
 * Repository отдаёт только строки (completed владельца, без skipped), здесь —
 * все правила Stage 4:
 * - workoutsCount включает все completed, даже без результатов;
 * - totalSets — не-skipped подходы не-skipped упражнений;
 * - totalReps — только метрики reps и reps_weight;
 * - totalVolume — только weight × reps для reps_weight;
 * - time участвует только в totalSets (и bestDuration в истории упражнения);
 * - история упражнения группируется строго по snapshot exerciseMetric.
 */

interface WorkoutTotals {
  sets: number;
  reps: number;
  volume: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** YYYY-MM-DD UTC + toExclusive = to + 1 день (граница to включительно). */
function toDateRange(query: StatsSummaryQuery | ExerciseStatsQuery): StatsDateRange | undefined {
  const from =
    query.from === undefined ? undefined : new Date(`${query.from}T00:00:00.000Z`);
  const toExclusive =
    query.to === undefined
      ? undefined
      : new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 86_400_000);
  if (from === undefined && toExclusive === undefined) {
    return undefined;
  }
  return { from, toExclusive };
}

/** Понедельник ISO-недели, 00:00 UTC. */
function isoWeekStart(date: Date): Date {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
}

function emptyBucket(): StatsBucketDto {
  return { workoutsCount: 0, totalSets: 0, totalReps: 0, totalVolume: 0 };
}

function bucketFor(map: Map<string, StatsBucketDto>, key: string): StatsBucketDto {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = emptyBucket();
    map.set(key, bucket);
  }
  return bucket;
}

function addWorkout(bucket: StatsBucketDto, totals: WorkoutTotals): void {
  bucket.workoutsCount += 1;
  bucket.totalSets += totals.sets;
  bucket.totalReps += totals.reps;
  bucket.totalVolume += totals.volume;
}

function withRoundedVolume(bucket: StatsBucketDto): StatsBucketDto {
  return { ...bucket, totalVolume: round2(bucket.totalVolume) };
}

/** Агрегаты одной тренировки по правилам метрик. */
function sumWorkout(row: SummaryWorkoutRow): WorkoutTotals {
  let sets = 0;
  let reps = 0;
  let volume = 0;

  for (const result of row.results) {
    const countsReps =
      result.exerciseMetric === 'reps' || result.exerciseMetric === 'reps_weight';
    const countsVolume = result.exerciseMetric === 'reps_weight';

    for (const set of result.sets) {
      sets += 1;
      if (countsReps && set.reps !== null) {
        reps += set.reps;
      }
      if (countsVolume && set.reps !== null && set.weight !== null) {
        volume += Number(set.weight) * set.reps;
      }
    }
  }

  return { sets, reps, volume };
}

/**
 * GET /api/stats/summary — сводка завершённых тренировок за период.
 * Пустой период → нули и пустые массивы; byPlace всегда содержит все три ключа.
 */
export async function getSummary(
  userId: number,
  query: StatsSummaryQuery,
): Promise<StatsSummaryDto> {
  const rows = await statsRepo.findSummaryWorkouts(userId, toDateRange(query));

  const byPlace: StatsByPlaceDto = { home: 0, outdoor: 0, gym: 0 };
  const byDay = new Map<string, StatsBucketDto>();
  const byWeek = new Map<string, StatsBucketDto>();
  let totalSets = 0;
  let totalReps = 0;
  let totalVolume = 0;

  for (const row of rows) {
    const totals = sumWorkout(row);
    totalSets += totals.sets;
    totalReps += totals.reps;
    totalVolume += totals.volume;

    if (row.place === 'home' || row.place === 'outdoor' || row.place === 'gym') {
      byPlace[row.place] += 1;
    }

    const dayKey = row.startedAt.toISOString().slice(0, 10);
    addWorkout(bucketFor(byDay, dayKey), totals);

    const weekKey = isoWeekStart(row.startedAt).toISOString().slice(0, 10);
    addWorkout(bucketFor(byWeek, weekKey), totals);
  }

  const days: StatsDayBucketDto[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, bucket]) => ({ date, ...withRoundedVolume(bucket) }));

  const weeks: StatsWeekBucketDto[] = [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([weekStart, bucket]) => ({ weekStart, ...withRoundedVolume(bucket) }));

  return {
    workoutsCount: rows.length,
    totalSets,
    totalReps,
    totalVolume: round2(totalVolume),
    byPlace,
    byDay: days,
    byWeek: weeks,
  };
}

/** Точка истории: агрегаты считаются по snapshot-метрике результата. */
function buildPoint(row: ExerciseHistoryRow): ExerciseStatsPointDto {
  const metric = row.exerciseMetric;
  let totalReps = 0;
  let totalVolume = 0;
  let bestReps: number | null = null;
  let bestWeight: number | null = null;
  let bestDuration: number | null = null;

  for (const set of row.sets) {
    if ((metric === 'reps' || metric === 'reps_weight') && set.reps !== null) {
      totalReps += set.reps;
      bestReps = bestReps === null ? set.reps : Math.max(bestReps, set.reps);
    }
    if (metric === 'reps_weight') {
      if (set.weight !== null) {
        const weight = Number(set.weight);
        bestWeight = bestWeight === null ? weight : Math.max(bestWeight, weight);
      }
      if (set.reps !== null && set.weight !== null) {
        totalVolume += Number(set.weight) * set.reps;
      }
    }
    if (metric === 'time' && set.duration !== null) {
      bestDuration = bestDuration === null ? set.duration : Math.max(bestDuration, set.duration);
    }
  }

  return {
    workoutId: row.workoutId,
    startedAt: row.workout.startedAt.toISOString(),
    totalSets: row.sets.length,
    totalReps,
    totalVolume: round2(totalVolume),
    bestReps,
    bestWeight,
    bestDuration,
  };
}

/**
 * GET /api/stats/exercises/:exerciseId — история упражнения.
 * - неизвестное или чужое персональное упражнение → 404;
 * - разные snapshot-метрики — отдельные серии, без смешивания;
 * - точки сортируются по startedAt возрастанию (repository отдаёт последние N).
 */
export async function getExerciseStats(
  userId: number,
  exerciseId: number,
  query: ExerciseStatsQuery,
): Promise<ExerciseStatsDto> {
  const exercise = await exerciseRepo.findExerciseById(exerciseId);
  if (!exercise || (exercise.userId !== null && exercise.userId !== userId)) {
    throw new AppError('NOT_FOUND', 'Упражнение не найдено');
  }

  const rows = await statsRepo.findExerciseHistory(
    userId,
    exerciseId,
    toDateRange(query),
    query.limit,
  );

  const byMetric = new Map<string, ExerciseStatsPointDto[]>();
  for (const row of rows) {
    const points = byMetric.get(row.exerciseMetric);
    if (points) {
      points.push(buildPoint(row));
    } else {
      byMetric.set(row.exerciseMetric, [buildPoint(row)]);
    }
  }

  const series: ExerciseStatsSeriesDto[] = [...byMetric.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([metric, points]) => ({
      metric,
      points: points.sort((a, b) =>
        a.startedAt === b.startedAt
          ? a.workoutId - b.workoutId
          : a.startedAt < b.startedAt
            ? -1
            : 1,
      ),
    }));

  return {
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    currentMetric: exercise.metric,
    metricChanged: series.some((item) => item.metric !== exercise.metric),
    series,
  };
}
