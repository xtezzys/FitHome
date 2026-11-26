import { beforeEach, describe, expect, it, vi } from 'vitest';

// Repositories мокаются: тестируем HTTP-контракты docs/api.md §6 (этап 4.4)
// через реальные routes → controllers → services.
vi.mock('../../repositories/stats.repository.js', () => ({
  findSummaryWorkouts: vi.fn(),
  findExerciseHistory: vi.fn(),
}));

vi.mock('../../repositories/exercise.repository.js', () => ({
  findExerciseById: vi.fn(),
}));

import request from 'supertest';
import { createApp } from '../../app.js';
import * as statsRepo from '../../repositories/stats.repository.js';
import * as exerciseRepo from '../../repositories/exercise.repository.js';
import { signAccessToken } from '../../lib/jwt.js';

const repo = vi.mocked(statsRepo);
const exRepo = vi.mocked(exerciseRepo);
const app = createApp();
const USER = 1;
const OTHER = 2;
const AUTH = (): [string, string] => ['Authorization', `Bearer ${signAccessToken(USER)}`];
const AUTH_OTHER = (): [string, string] => ['Authorization', `Bearer ${signAccessToken(OTHER)}`];
const now = new Date('2026-11-02T10:00:00.000Z');

function makeSummaryWorkout(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    place: 'home',
    startedAt: now,
    results: [],
    ...overrides,
  };
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
    workout: { startedAt: now, place: 'home' },
    sets: [{ order: 1, reps: 8, weight: '40.5', duration: null }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('Авторизация /api/stats', () => {
  it('401 UNAUTHORIZED без токена на оба эндпоинта', async () => {
    for (const action of [
      () => request(app).get('/api/stats/summary'),
      () => request(app).get('/api/stats/exercises/10'),
    ]) {
      const res = await action();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('GET /api/stats/summary', () => {
  it('200: сводка, период и userId из токена', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([
      makeSummaryWorkout({
        results: [{ exerciseMetric: 'reps', sets: [{ reps: 10, weight: null, duration: null }] }],
      }),
    ] as never);

    const res = await request(app)
      .get('/api/stats/summary?from=2026-11-01&to=2026-11-30')
      .set(...AUTH());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      workoutsCount: 1,
      totalSets: 1,
      totalReps: 10,
      totalVolume: 0,
    });
    expect(res.body.byPlace).toEqual({ home: 1, outdoor: 0, gym: 0 });
    expect(res.body.byDay).toEqual([
      { date: '2026-11-02', workoutsCount: 1, totalSets: 1, totalReps: 10, totalVolume: 0 },
    ]);
    expect(repo.findSummaryWorkouts).toHaveBeenCalledWith(USER, {
      from: new Date('2026-11-01T00:00:00.000Z'),
      toExclusive: new Date('2026-12-01T00:00:00.000Z'),
    });
  });

  it('userId берётся из токена, а не из query', async () => {
    repo.findSummaryWorkouts.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/stats/summary?userId=999')
      .set(...AUTH_OTHER());

    expect(res.status).toBe(200);
    expect(repo.findSummaryWorkouts.mock.calls[0][0]).toBe(OTHER);
  });

  it('400: несуществующая календарная дата, единый формат ошибки', async () => {
    const res = await request(app).get('/api/stats/summary?from=2026-02-30').set(...AUTH());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
  });

  it('400: from позже to', async () => {
    const res = await request(app)
      .get('/api/stats/summary?from=2026-12-01&to=2026-11-01')
      .set(...AUTH());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/stats/exercises/:exerciseId', () => {
  it('200: история сгруппирована по snapshot-метрикам', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
    repo.findExerciseHistory.mockResolvedValue([
      makeHistoryRow(),
      makeHistoryRow({
        id: 101,
        workoutId: 8,
        exerciseMetric: 'reps',
        sets: [{ order: 1, reps: 10, weight: null, duration: null }],
      }),
    ] as never);

    const res = await request(app).get('/api/stats/exercises/10').set(...AUTH());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      exerciseId: 10,
      exerciseName: 'Жим лёжа',
      currentMetric: 'reps_weight',
      metricChanged: true,
    });
    expect(res.body.series.map((s: { metric: string }) => s.metric)).toEqual([
      'reps',
      'reps_weight',
    ]);
    expect(repo.findExerciseHistory).toHaveBeenCalledWith(USER, 10, undefined, 50);
  });

  it('userId берётся из токена', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
    repo.findExerciseHistory.mockResolvedValue([]);

    const res = await request(app).get('/api/stats/exercises/10').set(...AUTH_OTHER());

    expect(res.status).toBe(200);
    expect(repo.findExerciseHistory.mock.calls[0][0]).toBe(OTHER);
  });

  it('400: limit больше 100', async () => {
    const res = await request(app).get('/api/stats/exercises/10?limit=101').set(...AUTH());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400: нечисловой exerciseId', async () => {
    const res = await request(app).get('/api/stats/exercises/abc').set(...AUTH());

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: expect.any(String) },
    });
  });

  it('404: несуществующее упражнение', async () => {
    exRepo.findExerciseById.mockResolvedValue(null);

    const res = await request(app).get('/api/stats/exercises/999').set(...AUTH());

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Упражнение не найдено' },
    });
    expect(repo.findExerciseHistory).not.toHaveBeenCalled();
  });

  it('404: чужое персональное упражнение', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ userId: OTHER }) as never);

    const res = await request(app).get('/api/stats/exercises/10').set(...AUTH());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(repo.findExerciseHistory).not.toHaveBeenCalled();
  });
});
