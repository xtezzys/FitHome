import { beforeEach, describe, expect, it, vi } from 'vitest';

// Prisma-клиент мокается: проверяем форму запросов (where/select/orderBy/take),
// без raw SQL (docs/database.md §9).
vi.mock('../prisma.js', () => ({
  prisma: {
    workout: { findMany: vi.fn() },
    workoutResult: { findMany: vi.fn() },
  },
}));

import { prisma } from '../prisma.js';
import * as statsRepo from '../stats.repository.js';

const mocked = vi.mocked(prisma, true);

const FROM = new Date('2026-11-01T00:00:00.000Z');
const TO_EXCLUSIVE = new Date('2026-12-01T00:00:00.000Z');

const SUMMARY_SELECT = {
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
};

const HISTORY_SELECT = {
  id: true,
  workoutId: true,
  exerciseMetric: true,
  workout: { select: { startedAt: true, place: true } },
  sets: {
    where: { skipped: false },
    select: { order: true, reps: true, weight: true, duration: true },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('findSummaryWorkouts', () => {
  it('без периода: только completed владельца, не-skipped результаты и подходы', async () => {
    mocked.workout.findMany.mockResolvedValue([]);

    await statsRepo.findSummaryWorkouts(2);

    expect(mocked.workout.findMany).toHaveBeenCalledWith({
      where: { userId: 2, status: 'completed' },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      select: SUMMARY_SELECT,
    });
  });

  it('с периодом: startedAt gte from и lt toExclusive (to включительно)', async () => {
    mocked.workout.findMany.mockResolvedValue([]);

    await statsRepo.findSummaryWorkouts(2, { from: FROM, toExclusive: TO_EXCLUSIVE });

    expect(mocked.workout.findMany).toHaveBeenCalledWith({
      where: {
        userId: 2,
        status: 'completed',
        startedAt: { gte: FROM, lt: TO_EXCLUSIVE },
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      select: SUMMARY_SELECT,
    });
  });

  it('передаёт только нижнюю или только верхнюю границу', async () => {
    mocked.workout.findMany.mockResolvedValue([]);

    await statsRepo.findSummaryWorkouts(2, { from: FROM });
    expect(mocked.workout.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { userId: 2, status: 'completed', startedAt: { gte: FROM } } }),
    );

    await statsRepo.findSummaryWorkouts(2, { toExclusive: TO_EXCLUSIVE });
    expect(mocked.workout.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { userId: 2, status: 'completed', startedAt: { lt: TO_EXCLUSIVE } },
      }),
    );
  });

  it('select не содержит лишних полей тренировки', async () => {
    mocked.workout.findMany.mockResolvedValue([]);

    await statsRepo.findSummaryWorkouts(2);

    const args = mocked.workout.findMany.mock.calls[0][0] as { select: Record<string, unknown> };
    expect(Object.keys(args.select).sort()).toEqual(['id', 'place', 'results', 'startedAt']);
  });

  it('возвращает строки репозитория без преобразований', async () => {
    const rows = [
      {
        id: 7,
        place: 'home',
        startedAt: FROM,
        results: [{ exerciseMetric: 'reps', sets: [{ reps: 10, weight: null, duration: null }] }],
      },
    ];
    mocked.workout.findMany.mockResolvedValue(rows as never);

    const result = await statsRepo.findSummaryWorkouts(2);

    expect(result).toEqual(rows);
  });
});

describe('findExerciseHistory', () => {
  it('фильтрует по exerciseId, completed владельца и не-skipped результатам/подходам', async () => {
    mocked.workoutResult.findMany.mockResolvedValue([]);

    await statsRepo.findExerciseHistory(2, 10, { from: FROM, toExclusive: TO_EXCLUSIVE }, 50);

    expect(mocked.workoutResult.findMany).toHaveBeenCalledWith({
      where: {
        exerciseId: 10,
        skipped: false,
        workout: {
          is: {
            userId: 2,
            status: 'completed',
            startedAt: { gte: FROM, lt: TO_EXCLUSIVE },
          },
        },
      },
      orderBy: [{ workout: { startedAt: 'desc' } }, { id: 'desc' }],
      take: 50,
      select: HISTORY_SELECT,
    });
  });

  it('без периода: workout.is без startedAt', async () => {
    mocked.workoutResult.findMany.mockResolvedValue([]);

    await statsRepo.findExerciseHistory(2, 10, undefined, 20);

    expect(mocked.workoutResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          exerciseId: 10,
          skipped: false,
          workout: { is: { userId: 2, status: 'completed' } },
        },
        take: 20,
      }),
    );
  });

  it('select содержит только поля точки истории', async () => {
    mocked.workoutResult.findMany.mockResolvedValue([]);

    await statsRepo.findExerciseHistory(2, 10, undefined, 50);

    const args = mocked.workoutResult.findMany.mock.calls[0][0] as {
      select: Record<string, unknown>;
    };
    expect(Object.keys(args.select).sort()).toEqual([
      'exerciseMetric',
      'id',
      'sets',
      'workout',
      'workoutId',
    ]);
  });

  it('возвращает последние точки (desc) как есть', async () => {
    const rows = [
      {
        id: 100,
        workoutId: 7,
        exerciseMetric: 'reps_weight',
        workout: { startedAt: FROM, place: 'gym' },
        sets: [{ order: 1, reps: 8, weight: '40.5', duration: null }],
      },
    ];
    mocked.workoutResult.findMany.mockResolvedValue(rows as never);

    const result = await statsRepo.findExerciseHistory(2, 10, undefined, 50);

    expect(result).toEqual(rows);
  });
});
