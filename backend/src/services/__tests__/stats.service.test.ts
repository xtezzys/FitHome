import { beforeEach, describe, expect, it, vi } from 'vitest';

// Repositories мокаются: тестируем правила расчётов Stage 4 (docs/api.md §6).
vi.mock('../../repositories/stats.repository.js', () => ({
  findSummaryWorkouts: vi.fn(),
  findExerciseHistory: vi.fn(),
}));

vi.mock('../../repositories/exercise.repository.js', () => ({
  findExerciseById: vi.fn(),
}));

import * as statsRepo from '../../repositories/stats.repository.js';
import * as exerciseRepo from '../../repositories/exercise.repository.js';
import * as statsService from '../stats.service.js';

const repo = vi.mocked(statsRepo);
const exRepo = vi.mocked(exerciseRepo);
const USER = 1;
const OTHER = 2;

function makeSummaryWorkout(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    place: 'home',
    startedAt: new Date('2026-11-02T10:00:00.000Z'),
    results: [],
    ...overrides,
  };
}

function makeResult(metric: string, sets: Array<Record<string, unknown>>) {
  return { exerciseMetric: metric, sets };
}

function makeSet(reps: number | null, weight: unknown = null, duration: number | null = null) {
  return { reps, weight, duration };
}

function makeExercise(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    name: 'Жим лёжа',
    nameLower: 'жим лёжа',
    description: null,
    place: 'gym',
    metric: 'reps_weight',
    muscleGroups: ',chest,',
    difficulty: 'medium',
    equipment: ',barbell,',
    userId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeHistoryRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    workoutId: 7,
    exerciseMetric: 'reps_weight',
    workout: { startedAt: new Date('2026-11-02T10:00:00.000Z'), place: 'home' },
    sets: [{ order: 1, reps: 8, weight: '40.5', duration: null }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('getSummary — пустой период и границы', () => {
  it('без данных возвращает нули, все места и пустые группировки', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([]);

    const dto = await statsService.getSummary(USER, {});

    expect(dto).toEqual({
      workoutsCount: 0,
      totalSets: 0,
      totalReps: 0,
      totalVolume: 0,
      byPlace: { home: 0, outdoor: 0, gym: 0 },
      byDay: [],
      byWeek: [],
    });
    expect(repo.findSummaryWorkouts).toHaveBeenCalledWith(USER, undefined);
  });

  it('from/to преобразуются в UTC-диапазон, to включительно (+1 день)', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([]);

    await statsService.getSummary(USER, { from: '2026-11-01', to: '2026-11-30' });

    expect(repo.findSummaryWorkouts).toHaveBeenCalledWith(USER, {
      from: new Date('2026-11-01T00:00:00.000Z'),
      toExclusive: new Date('2026-12-01T00:00:00.000Z'),
    });
  });

  it('передаёт только одну границу', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([]);

    await statsService.getSummary(USER, { from: '2026-11-01' });
    expect(repo.findSummaryWorkouts).toHaveBeenLastCalledWith(USER, {
      from: new Date('2026-11-01T00:00:00.000Z'),
      toExclusive: undefined,
    });

    await statsService.getSummary(USER, { to: '2026-11-30' });
    expect(repo.findSummaryWorkouts).toHaveBeenLastCalledWith(USER, {
      from: undefined,
      toExclusive: new Date('2026-12-01T00:00:00.000Z'),
    });
  });
});

describe('getSummary — правила подсчёта', () => {
  it('workoutsCount включает completed без результатов', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({ id: 1, results: [] }),
      makeSummaryWorkout({ id: 2, results: [makeResult('reps', [makeSet(10)])] }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.workoutsCount).toBe(2);
    expect(dto.totalSets).toBe(1);
    expect(dto.totalReps).toBe(10);
  });

  it('totalSets по всем метрикам, totalReps — reps/reps_weight, totalVolume — weight × reps', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({
        results: [
          makeResult('reps', [makeSet(10), makeSet(12)]),
          makeResult('reps_weight', [makeSet(8, '40.5')]),
          makeResult('time', [makeSet(null, null, 60)]),
        ],
      }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.totalSets).toBe(4);
    expect(dto.totalReps).toBe(30);
    expect(dto.totalVolume).toBe(324);
  });

  it('time учитывается только в totalSets', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({
        results: [makeResult('time', [makeSet(null, null, 60), makeSet(null, null, 90)])],
      }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.totalSets).toBe(2);
    expect(dto.totalReps).toBe(0);
    expect(dto.totalVolume).toBe(0);
  });

  it('null reps/weight не попадают в повторения и объём', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({
        results: [makeResult('reps_weight', [makeSet(null, '50'), makeSet(10, null)])],
      }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.totalSets).toBe(2);
    expect(dto.totalReps).toBe(10);
    expect(dto.totalVolume).toBe(0);
  });

  it('Decimal weight конвертируется, объём округляется до 2 знаков', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({
        results: [makeResult('reps_weight', [makeSet(3, '0.1')])],
      }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.totalVolume).toBe(0.3);
  });

  it('byPlace считает тренировки, неизвестные места игнорируются', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({ id: 1, place: 'home' }),
      makeSummaryWorkout({ id: 2, place: 'home' }),
      makeSummaryWorkout({ id: 3, place: 'gym' }),
      makeSummaryWorkout({ id: 4, place: 'outdoor' }),
      makeSummaryWorkout({ id: 5, place: 'park' }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.workoutsCount).toBe(5);
    expect(dto.byPlace).toEqual({ home: 2, outdoor: 1, gym: 1 });
  });

  it('byDay группирует по UTC-дате и суммирует метрики', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({
        id: 1,
        startedAt: new Date('2026-11-02T08:00:00.000Z'),
        results: [makeResult('reps', [makeSet(10)])],
      }),
      makeSummaryWorkout({
        id: 2,
        startedAt: new Date('2026-11-02T20:00:00.000Z'),
        results: [makeResult('reps', [makeSet(5)])],
      }),
      makeSummaryWorkout({
        id: 3,
        startedAt: new Date('2026-11-03T09:00:00.000Z'),
        results: [makeResult('time', [makeSet(null, null, 60)])],
      }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.byDay).toEqual([
      { date: '2026-11-02', workoutsCount: 2, totalSets: 2, totalReps: 15, totalVolume: 0 },
      { date: '2026-11-03', workoutsCount: 1, totalSets: 1, totalReps: 0, totalVolume: 0 },
    ]);
  });
});

describe('getSummary — ISO-недели (понедельник UTC)', () => {
  it('воскресенье и понедельник относятся к разным неделям', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({ id: 1, startedAt: new Date('2026-11-01T23:00:00.000Z') }),
      makeSummaryWorkout({ id: 2, startedAt: new Date('2026-11-02T00:00:00.000Z') }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.byWeek.map((w) => w.weekStart)).toEqual(['2026-10-26', '2026-11-02']);
    expect(dto.byWeek.map((w) => w.workoutsCount)).toEqual([1, 1]);
  });

  it('1 января относится к неделе, начавшейся 29 декабря', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({ id: 1, startedAt: new Date('2025-12-29T10:00:00.000Z') }),
      makeSummaryWorkout({ id: 2, startedAt: new Date('2026-01-01T12:00:00.000Z') }),
      makeSummaryWorkout({ id: 3, startedAt: new Date('2026-01-04T23:59:00.000Z') }),
      makeSummaryWorkout({ id: 4, startedAt: new Date('2026-01-05T00:00:00.000Z') }),
    ] as never);

    const dto = await statsService.getSummary(USER, {});

    expect(dto.byWeek).toEqual([
      { weekStart: '2025-12-29', workoutsCount: 3, totalSets: 0, totalReps: 0, totalVolume: 0 },
      { weekStart: '2026-01-05', workoutsCount: 1, totalSets: 0, totalReps: 0, totalVolume: 0 },
    ]);
  });
});

describe('getExerciseStats — доступ', () => {
  it('неизвестное упражнение → 404, история не запрашивается', async () => {
    exRepo.findExerciseById.mockResolvedValue(null);

    await expect(statsService.getExerciseStats(USER, 10, { limit: 50 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Упражнение не найдено',
    });
    expect(repo.findExerciseHistory).not.toHaveBeenCalled();
  });

  it('чужое персональное упражнение → 404', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ userId: OTHER }) as never);

    await expect(statsService.getExerciseStats(USER, 10, { limit: 50 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repo.findExerciseHistory).not.toHaveBeenCalled();
  });

  it('своё персональное упражнение доступно', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ userId: USER }) as never);
    repo.findExerciseHistory.mockResolvedValue([]);

    await expect(statsService.getExerciseStats(USER, 10, { limit: 50 })).resolves.toMatchObject({
      exerciseId: 10,
    });
  });
});

describe('getExerciseStats — группировка и расчёты', () => {
  it('разные snapshot-метрики находятся в отдельных сериях', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ metric: 'reps_weight' }) as never);
    repo.findExerciseHistory.mockResolvedValue([
      makeHistoryRow({
        id: 1,
        workoutId: 1,
        exerciseMetric: 'reps',
        sets: [{ order: 1, reps: 10, weight: null, duration: null }],
      }),
      makeHistoryRow({
        id: 2,
        workoutId: 2,
        exerciseMetric: 'time',
        sets: [{ order: 1, reps: null, weight: null, duration: 60 }],
      }),
      makeHistoryRow({
        id: 3,
        workoutId: 3,
        exerciseMetric: 'reps_weight',
        sets: [{ order: 1, reps: 8, weight: '40.5', duration: null }],
      }),
    ] as never);

    const dto = await statsService.getExerciseStats(USER, 10, { limit: 50 });

    expect(dto.series.map((s) => s.metric)).toEqual(['reps', 'reps_weight', 'time']);
    expect(dto.currentMetric).toBe('reps_weight');
    expect(dto.metricChanged).toBe(true);
    expect(dto.series[0].points).toHaveLength(1);
    expect(dto.series[1].points).toHaveLength(1);
    expect(dto.series[2].points).toHaveLength(1);
  });

  it('metricChanged=false, если все серии совпадают с текущей метрикой', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ metric: 'reps' }) as never);
    repo.findExerciseHistory.mockResolvedValue([
      makeHistoryRow({
        id: 1,
        exerciseMetric: 'reps',
        sets: [{ order: 1, reps: 10, weight: null, duration: null }],
      }),
    ] as never);

    const dto = await statsService.getExerciseStats(USER, 10, { limit: 50 });

    expect(dto.currentMetric).toBe('reps');
    expect(dto.metricChanged).toBe(false);
  });

  it('reps_weight: totalSets/totalReps/totalVolume и лучшие значения', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
    repo.findExerciseHistory.mockResolvedValue([
      makeHistoryRow({
        sets: [
          { order: 1, reps: 8, weight: '40.5', duration: null },
          { order: 2, reps: 10, weight: '50', duration: null },
        ],
      }),
    ] as never);

    const dto = await statsService.getExerciseStats(USER, 10, { limit: 50 });
    const point = dto.series[0].points[0];

    expect(point).toMatchObject({
      totalSets: 2,
      totalReps: 18,
      totalVolume: 824,
      bestReps: 10,
      bestWeight: 50,
      bestDuration: null,
    });
  });

  it('time: только totalSets и bestDuration, без повторов и объёма', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ metric: 'time' }) as never);
    repo.findExerciseHistory.mockResolvedValue([
      makeHistoryRow({
        exerciseMetric: 'time',
        sets: [
          { order: 1, reps: null, weight: null, duration: 60 },
          { order: 2, reps: null, weight: null, duration: 90 },
        ],
      }),
    ] as never);

    const dto = await statsService.getExerciseStats(USER, 10, { limit: 50 });
    const point = dto.series[0].points[0];

    expect(point).toMatchObject({
      totalSets: 2,
      totalReps: 0,
      totalVolume: 0,
      bestReps: null,
      bestWeight: null,
      bestDuration: 90,
    });
  });

  it('Decimal weight и округление totalVolume до 2 знаков', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
    repo.findExerciseHistory.mockResolvedValue([
      makeHistoryRow({ sets: [{ order: 1, reps: 3, weight: '0.1', duration: null }] }),
    ] as never);

    const dto = await statsService.getExerciseStats(USER, 10, { limit: 50 });

    expect(dto.series[0].points[0].totalVolume).toBe(0.3);
  });

  it('точки сортируются по startedAt возрастанию, tie-break по workoutId', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ metric: 'reps' }) as never);
    repo.findExerciseHistory.mockResolvedValue([
      makeHistoryRow({
        id: 3,
        workoutId: 30,
        exerciseMetric: 'reps',
        workout: { startedAt: new Date('2026-11-03T10:00:00.000Z'), place: 'home' },
        sets: [{ order: 1, reps: 5, weight: null, duration: null }],
      }),
      makeHistoryRow({
        id: 2,
        workoutId: 20,
        exerciseMetric: 'reps',
        workout: { startedAt: new Date('2026-11-02T10:00:00.000Z'), place: 'home' },
        sets: [{ order: 1, reps: 5, weight: null, duration: null }],
      }),
      makeHistoryRow({
        id: 1,
        workoutId: 10,
        exerciseMetric: 'reps',
        workout: { startedAt: new Date('2026-11-02T10:00:00.000Z'), place: 'home' },
        sets: [{ order: 1, reps: 5, weight: null, duration: null }],
      }),
    ] as never);

    const dto = await statsService.getExerciseStats(USER, 10, { limit: 50 });

    expect(dto.series[0].points.map((p) => p.workoutId)).toEqual([10, 20, 30]);
  });

  it('передаёт период и limit в repository', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
    repo.findExerciseHistory.mockResolvedValue([]);

    await statsService.getExerciseStats(USER, 10, {
      from: '2026-11-01',
      to: '2026-11-30',
      limit: 25,
    });

    expect(repo.findExerciseHistory).toHaveBeenCalledWith(
      USER,
      10,
      {
        from: new Date('2026-11-01T00:00:00.000Z'),
        toExclusive: new Date('2026-12-01T00:00:00.000Z'),
      },
      25,
    );
  });

  it('пустая история → пустые серии, metricChanged=false', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
    repo.findExerciseHistory.mockResolvedValue([]);

    const dto = await statsService.getExerciseStats(USER, 10, { limit: 50 });

    expect(dto).toMatchObject({
      exerciseId: 10,
      exerciseName: 'Жим лёжа',
      currentMetric: 'reps_weight',
      metricChanged: false,
      series: [],
    });
  });
});
