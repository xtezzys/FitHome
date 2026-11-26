import { beforeEach, describe, expect, it, vi } from 'vitest';

// Repositories мокаются: тестируем HTTP-контракты docs/api.md §5 (этап 4)
// через реальные routes → controllers → services.
vi.mock('../../repositories/workout.repository.js', () => ({
  runTransaction: vi.fn(),
  createWorkout: vi.fn(),
  findWorkoutById: vi.fn(),
  findActiveByUser: vi.fn(),
  findWorkoutRevision: vi.fn(),
  casUpdateWorkout: vi.fn(),
  deleteWorkoutResults: vi.fn(),
  createWorkoutResult: vi.fn(),
  createWorkoutSets: vi.fn(),
  updateWorkoutNotes: vi.fn(),
  listWorkouts: vi.fn(),
  deleteWorkout: vi.fn(),
}));

vi.mock('../../repositories/program.repository.js', () => ({
  findProgramById: vi.fn(),
  findProgramExerciseById: vi.fn(),
}));

vi.mock('../../repositories/exercise.repository.js', () => ({
  findExerciseById: vi.fn(),
}));

import request from 'supertest';
import { createApp } from '../../app.js';
import * as workoutRepo from '../../repositories/workout.repository.js';
import * as exerciseRepo from '../../repositories/exercise.repository.js';
import { signAccessToken } from '../../lib/jwt.js';

const repo = vi.mocked(workoutRepo);
const exRepo = vi.mocked(exerciseRepo);
const app = createApp();
const USER = 1;
const OTHER = 2;
const AUTH = (): [string, string] => ['Authorization', `Bearer ${signAccessToken(USER)}`];
const now = new Date('2026-11-12T18:00:00.000Z');

function makeSet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 900,
    workoutResultId: 100,
    order: 1,
    reps: 10,
    weight: null,
    duration: null,
    skipped: false,
    ...overrides,
  };
}

function makeResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    workoutId: 7,
    exerciseId: 10,
    programExerciseId: null,
    exerciseName: 'Отжимания',
    exerciseMetric: 'reps',
    order: 1,
    skipped: false,
    notes: null,
    createdAt: now,
    sets: [makeSet()],
    ...overrides,
  };
}

function makeWorkout(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    userId: USER,
    programId: null,
    programName: null,
    place: 'home',
    status: 'in_progress',
    revision: 0,
    startedAt: now,
    completedAt: null,
    durationSec: null,
    notes: null,
    createdAt: now,
    results: [],
    ...overrides,
  };
}

function makeExercise(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    name: 'Отжимания',
    nameLower: 'отжимания',
    description: null,
    place: 'home',
    metric: 'reps',
    muscleGroups: ',chest,triceps,',
    difficulty: 'easy',
    equipment: null,
    userId: null,
    createdAt: now,
    ...overrides,
  };
}

function makeListItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    userId: USER,
    programId: 50,
    programName: 'Моя программа',
    place: 'home',
    status: 'completed',
    revision: 3,
    startedAt: now,
    completedAt: now,
    durationSec: 3600,
    notes: null,
    createdAt: now,
    _count: { results: 2 },
    results: [{ _count: { sets: 3 } }, { _count: { sets: 2 } }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  repo.runTransaction.mockImplementation(async (fn) => fn({} as never));
});

describe('Авторизация /api/workouts', () => {
  it('401 UNAUTHORIZED без токена на все эндпоинты', async () => {
    for (const action of [
      () => request(app).post('/api/workouts').send({ place: 'home' }),
      () => request(app).get('/api/workouts/active'),
      () => request(app).get('/api/workouts'),
      () => request(app).get('/api/workouts/7'),
      () => request(app).put('/api/workouts/7/results').send({}),
      () => request(app).put('/api/workouts/7').send({}),
      () => request(app).post('/api/workouts/7/complete').send({}),
      () => request(app).post('/api/workouts/7/cancel'),
      () => request(app).delete('/api/workouts/7'),
    ]) {
      const res = await action();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('POST /api/workouts', () => {
  it('201: свободная тренировка, userId из токена', async () => {
    repo.findActiveByUser.mockResolvedValue(null);
    repo.createWorkout.mockResolvedValue({ id: 7 } as never);
    repo.findWorkoutById.mockResolvedValue(makeWorkout() as never);

    const res = await request(app).post('/api/workouts').set(...AUTH()).send({ place: 'home' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 7, userId: USER, status: 'in_progress', revision: 0, results: [] });
    expect(repo.findActiveByUser).toHaveBeenCalledWith(USER);
    expect(repo.createWorkout).toHaveBeenCalledWith(
      { userId: USER, programId: null, programName: null, place: 'home' },
      expect.anything(),
    );
  });

  it('409: уже есть активная тренировка', async () => {
    repo.findActiveByUser.mockResolvedValue(makeWorkout({ id: 42 }) as never);

    const res = await request(app).post('/api/workouts').set(...AUTH()).send({ place: 'home' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('id=42');
  });

  it('400: неизвестное место', async () => {
    const res = await request(app).post('/api/workouts').set(...AUTH()).send({ place: 'moon' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/workouts/active', () => {
  it('200: активная тренировка с результатами и подходами', async () => {
    repo.findActiveByUser.mockResolvedValue(makeWorkout({ results: [makeResult()] }) as never);

    const res = await request(app).get('/api/workouts/active').set(...AUTH());

    expect(res.status).toBe(200);
    expect(res.body.results[0].sets[0]).toMatchObject({ reps: 10 });
    expect(repo.findActiveByUser).toHaveBeenCalledWith(USER);
  });

  it('404: активной нет', async () => {
    repo.findActiveByUser.mockResolvedValue(null);

    const res = await request(app).get('/api/workouts/active').set(...AUTH());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/workouts', () => {
  it('200: история только completed, userId из токена, агрегаты', async () => {
    repo.listWorkouts.mockResolvedValue([[makeListItem()], 1] as never);

    const res = await request(app).get('/api/workouts?page=1&limit=20').set(...AUTH());

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(res.body.data[0]).toMatchObject({ id: 7, exercisesCount: 2, totalSets: 5, durationSec: 3600 });
    expect(repo.listWorkouts.mock.calls[0][0]).toEqual({ userId: USER, status: 'completed' });
  });

  it('400: несуществующая календарная дата', async () => {
    const res = await request(app).get('/api/workouts?from=2026-02-30').set(...AUTH());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400: limit больше допустимого', async () => {
    const res = await request(app).get('/api/workouts?limit=1000').set(...AUTH());

    expect(res.status).toBe(400);
  });
});

describe('GET /api/workouts/:id', () => {
  it('200: своя тренировка с результатами', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ results: [makeResult()] }) as never);

    const res = await request(app).get('/api/workouts/7').set(...AUTH());

    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ exerciseName: 'Отжимания', exerciseMetric: 'reps' });
  });

  it('404: чужая тренировка (изоляция пользователей)', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ userId: OTHER }) as never);

    const res = await request(app).get('/api/workouts/7').set(...AUTH());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('404: неизвестный id', async () => {
    repo.findWorkoutById.mockResolvedValue(null);

    const res = await request(app).get('/api/workouts/999').set(...AUTH());

    expect(res.status).toBe(404);
  });

  it('400: нечисловой id', async () => {
    const res = await request(app).get('/api/workouts/abc').set(...AUTH());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PUT /api/workouts/:id/results', () => {
  const body = {
    revision: 2,
    results: [{ order: 1, exerciseId: 10, sets: [{ order: 1, reps: 10 }] }],
  };

  it('200: полная замена, revision инкрементируется', async () => {
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ revision: 2 }) as never)
      .mockResolvedValueOnce(makeWorkout({ revision: 3, results: [makeResult()] }) as never);
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);
    repo.createWorkoutResult.mockResolvedValue({ id: 100 } as never);
    repo.createWorkoutSets.mockResolvedValue({ count: 1 } as never);

    const res = await request(app).put('/api/workouts/7/results').set(...AUTH()).send(body);

    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(3);
    expect(repo.casUpdateWorkout).toHaveBeenCalledWith(
      { id: 7, userId: USER, status: 'in_progress', revision: 2 },
      {},
      expect.anything(),
    );
  });

  it('409: revision conflict с актуальной revision в сообщении', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ revision: 2 }) as never);
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 0 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 5,
    } as never);

    const res = await request(app).put('/api/workouts/7/results').set(...AUTH()).send(body);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toContain('актуальная: 5');
  });

  it('404: чужая тренировка', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ userId: OTHER }) as never);

    const res = await request(app).put('/api/workouts/7/results').set(...AUTH()).send(body);

    expect(res.status).toBe(404);
  });

  it('400: некорректное тело', async () => {
    const res = await request(app).put('/api/workouts/7/results').set(...AUTH()).send({ results: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('PUT /api/workouts/:id', () => {
  it('200: обновление заметок', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 3,
    } as never);
    repo.updateWorkoutNotes.mockResolvedValue({} as never);
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'completed', notes: 'новые' }) as never);

    const res = await request(app).put('/api/workouts/7').set(...AUTH()).send({ notes: 'новые' });

    expect(res.status).toBe(200);
    expect(res.body.notes).toBe('новые');
    expect(repo.updateWorkoutNotes).toHaveBeenCalledWith(7, 'новые');
  });

  it('404: чужая тренировка (изоляция)', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: OTHER,
      status: 'completed',
      revision: 3,
    } as never);

    const res = await request(app).put('/api/workouts/7').set(...AUTH()).send({ notes: 'x' });

    expect(res.status).toBe(404);
    expect(repo.updateWorkoutNotes).not.toHaveBeenCalled();
  });

  it('400: поле notes отсутствует', async () => {
    const res = await request(app).put('/api/workouts/7').set(...AUTH()).send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/workouts/:id/complete', () => {
  it('200: завершение активной тренировки', async () => {
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ revision: 2 }) as never)
      .mockResolvedValueOnce(
        makeWorkout({ revision: 3, status: 'completed', completedAt: now, durationSec: 60 }) as never,
      );
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);

    const res = await request(app).post('/api/workouts/7/complete').set(...AUTH()).send({ revision: 2 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(repo.casUpdateWorkout).toHaveBeenCalledWith(
      { id: 7, userId: USER, status: 'in_progress', revision: 2 },
      expect.objectContaining({ status: 'completed', durationSec: expect.any(Number) }),
    );
  });

  it('409: уже завершена', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'completed' }) as never);

    const res = await request(app).post('/api/workouts/7/complete').set(...AUTH()).send({ revision: 2 });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('404: неизвестный id', async () => {
    repo.findWorkoutById.mockResolvedValue(null);

    const res = await request(app).post('/api/workouts/999/complete').set(...AUTH()).send({ revision: 0 });

    expect(res.status).toBe(404);
  });

  it('400: revision отсутствует', async () => {
    const res = await request(app).post('/api/workouts/7/complete').set(...AUTH()).send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/workouts/:id/cancel', () => {
  it('200: отмена активной тренировки', async () => {
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ revision: 2 }) as never)
      .mockResolvedValueOnce(makeWorkout({ revision: 3, status: 'cancelled' }) as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);

    const res = await request(app).post('/api/workouts/7/cancel').set(...AUTH());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('200: повторная отмена идемпотентна', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'cancelled', revision: 5 }) as never);

    const res = await request(app).post('/api/workouts/7/cancel').set(...AUTH());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(repo.casUpdateWorkout).not.toHaveBeenCalled();
  });

  it('409: завершённую отменить нельзя', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'completed' }) as never);

    const res = await request(app).post('/api/workouts/7/cancel').set(...AUTH());

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('DELETE /api/workouts/:id', () => {
  it('204: удаление завершённой тренировки', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 3,
    } as never);
    repo.deleteWorkout.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/workouts/7').set(...AUTH());

    expect(res.status).toBe(204);
    expect(repo.deleteWorkout).toHaveBeenCalledWith(7);
  });

  it('409: активную тренировку удалить нельзя', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 2,
    } as never);

    const res = await request(app).delete('/api/workouts/7').set(...AUTH());

    expect(res.status).toBe(409);
    expect(repo.deleteWorkout).not.toHaveBeenCalled();
  });

  it('404: чужая тренировка (изоляция)', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: OTHER,
      status: 'completed',
      revision: 3,
    } as never);

    const res = await request(app).delete('/api/workouts/7').set(...AUTH());

    expect(res.status).toBe(404);
    expect(repo.deleteWorkout).not.toHaveBeenCalled();
  });

  it('404: неизвестный id', async () => {
    repo.findWorkoutRevision.mockResolvedValue(null);

    const res = await request(app).delete('/api/workouts/999').set(...AUTH());

    expect(res.status).toBe(404);
  });
});
