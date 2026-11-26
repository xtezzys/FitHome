import { beforeEach, describe, expect, it, vi } from 'vitest';

// Repositories мокаются: тестируем HTTP-контракты docs/api.md §4 (этап 3)
vi.mock('../../repositories/exercise.repository.js', () => ({
  listExercises: vi.fn(),
  findExerciseById: vi.fn(),
  findPersonalByNameLower: vi.fn(),
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
}));

vi.mock('../../repositories/program.repository.js', () => ({
  runTransaction: vi.fn(),
  listPrograms: vi.fn(),
  findProgramById: vi.fn(),
  createProgram: vi.fn(),
  updateProgram: vi.fn(),
  softDeleteProgram: vi.fn(),
  findProgramExerciseById: vi.fn(),
  findProgramExerciseByOrder: vi.fn(),
  listProgramExercises: vi.fn(),
  findMaxProgramExerciseOrder: vi.fn(),
  createProgramExercise: vi.fn(),
  updateProgramExercise: vi.fn(),
  deleteProgramExercise: vi.fn(),
  updateProgramExerciseOrder: vi.fn(),
}));

import request from 'supertest';
import { createApp } from '../../app.js';
import * as programRepo from '../../repositories/program.repository.js';
import * as exerciseRepo from '../../repositories/exercise.repository.js';
import { signAccessToken } from '../../lib/jwt.js';

const repo = vi.mocked(programRepo);
const exRepo = vi.mocked(exerciseRepo);
const app = createApp();
const AUTH = (): [string, string] => ['Authorization', `Bearer ${signAccessToken(1)}`];
const now = new Date('2026-11-11T10:00:00.000Z');
const USER = 1;
const OTHER = 2;

function makeExercise(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
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

function makePe(exercise: ReturnType<typeof makeExercise>, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 500,
    programId: 50,
    exerciseId: exercise.id,
    order: 1,
    targetSets: 3,
    targetReps: 15,
    targetWeight: null,
    targetDuration: null,
    restSec: 90,
    exercise,
    ...overrides,
  };
}

function makeProgram(exercises: ReturnType<typeof makePe>[], overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 50,
    userId: USER,
    name: 'Моя программа',
    description: null,
    place: 'home',
    isActive: true,
    isPublic: false,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    user: { name: 'Автор' },
    exercises,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  repo.runTransaction.mockImplementation((fn) => fn({} as never));
});

describe('Авторизация /api/programs', () => {
  it('401 UNAUTHORIZED без токена', async () => {
    for (const action of [
      () => request(app).get('/api/programs'),
      () => request(app).get('/api/programs/50'),
      () => request(app).post('/api/programs').send({}),
      () => request(app).put('/api/programs/50').send({}),
      () => request(app).delete('/api/programs/50'),
      () => request(app).post('/api/programs/50/copy'),
      () => request(app).post('/api/programs/50/exercises').send({}),
      () => request(app).put('/api/programs/50/exercises/500').send({}),
      () => request(app).put('/api/programs/50/exercises/order').send({}),
      () => request(app).delete('/api/programs/50/exercises/500'),
    ]) {
      const res = await action();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('GET /api/programs', () => {
  it('200: scope=mine — свои программы с exercisesCount', async () => {
    const program = {
      id: 50, userId: USER, name: 'Моя', description: null, place: 'home',
      isActive: true, isPublic: false, publishedAt: null,
      createdAt: now, updatedAt: now,
      user: { name: 'Автор' },
      _count: { exercises: 3 },
    };
    repo.listPrograms.mockResolvedValue([[program], 1]);
    const res = await request(app).get('/api/programs').set(...AUTH());
    expect(res.status).toBe(200);
    expect(res.body.data[0].exercisesCount).toBe(3);
    expect(res.body.data[0].exercises).toBeUndefined();
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
    const [where] = repo.listPrograms.mock.calls[0];
    expect(where).toMatchObject({ userId: USER });
  });

  it('200: scope=ready — готовые программы, only userId=null + isActive', async () => {
    repo.listPrograms.mockResolvedValue([[], 0]);
    const res = await request(app).get('/api/programs?scope=ready').set(...AUTH());
    expect(res.status).toBe(200);
    const [where] = repo.listPrograms.mock.calls[0];
    expect(where).toMatchObject({ userId: null, isActive: true });
  });

  it('400: некорректный scope', async () => {
    const res = await request(app).get('/api/programs?scope=all').set(...AUTH());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/programs/:id', () => {
  it('200: своя программа с упорядоченным составом', async () => {
    const ex = makeExercise();
    repo.findProgramById.mockResolvedValue(makeProgram([makePe(ex)], { userId: USER }) as never);
    const res = await request(app).get('/api/programs/50').set(...AUTH());
    expect(res.status).toBe(200);
    expect(res.body.exercises[0]).toMatchObject({
      programExerciseId: 500,
      order: 1,
      targetSets: 3,
      targetWeight: null,
      restSec: 90,
      exercise: { id: 100, muscleGroups: ['chest', 'triceps'] },
    });
  });

  it('200: готовая программа доступна для чтения', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: null, id: 60, name: 'Готовая' }) as never);
    const res = await request(app).get('/api/programs/60').set(...AUTH());
    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
  });

  it('403 чужая персональная; 404 не найдена', async () => {
    repo.findProgramById.mockResolvedValueOnce(makeProgram([], { userId: OTHER }) as never);
    const forbidden = await request(app).get('/api/programs/50').set(...AUTH());
    expect(forbidden.status).toBe(403);

    repo.findProgramById.mockResolvedValueOnce(null);
    const notFound = await request(app).get('/api/programs/999').set(...AUTH());
    expect(notFound.status).toBe(404);
  });
});

describe('POST /api/programs', () => {
  it('201: создаёт программу с userId из токена', async () => {
    repo.createProgram.mockResolvedValue({ id: 51, userId: USER, name: 'Новая', description: null, place: 'gym', isActive: true, createdAt: now, updatedAt: now } as never);
    repo.findProgramById.mockResolvedValue(makeProgram([], { id: 51, name: 'Новая', place: 'gym', userId: USER }) as never);
    const res = await request(app).post('/api/programs').set(...AUTH()).send({ name: 'Новая', place: 'gym' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(USER);
    expect(repo.createProgram).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, place: 'gym', isActive: true }));
  });

  it('400: нет name или недопустимое place', async () => {
    for (const body of [{ place: 'gym' }, { name: 'X', place: 'office' }]) {
      const res = await request(app).post('/api/programs').set(...AUTH()).send(body);
      expect(res.status).toBe(400);
    }
  });
});

describe('PUT /api/programs/:id', () => {
  it('200: обновление своей программы', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: USER }) as never);
    repo.updateProgram.mockResolvedValue({} as never);
    repo.findProgramById.mockResolvedValueOnce(makeProgram([], { userId: USER }) as never).mockResolvedValueOnce(
      makeProgram([], { userId: USER, name: 'Обновлённая' }) as never,
    );
    const res = await request(app).put('/api/programs/50').set(...AUTH()).send({ name: 'Обновлённая' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Обновлённая');
  });

  it('403: готовая (read-only) и чужая', async () => {
    repo.findProgramById.mockResolvedValueOnce(makeProgram([], { userId: null }) as never);
    const ready = await request(app).put('/api/programs/50').set(...AUTH()).send({ name: 'X' });
    expect(ready.status).toBe(403);

    repo.findProgramById.mockResolvedValueOnce(makeProgram([], { userId: OTHER }) as never);
    const foreign = await request(app).put('/api/programs/50').set(...AUTH()).send({ name: 'X' });
    expect(foreign.status).toBe(403);
  });
});

describe('DELETE /api/programs/:id', () => {
  it('204: soft delete своей программы (isActive=false)', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: USER }) as never);
    repo.softDeleteProgram.mockResolvedValue(makeProgram([], { isActive: false }) as never);
    const res = await request(app).delete('/api/programs/50').set(...AUTH());
    expect(res.status).toBe(204);
    expect(repo.softDeleteProgram).toHaveBeenCalledWith(50);
  });

  it('403: готовую программу удалить нельзя', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: null }) as never);
    const res = await request(app).delete('/api/programs/50').set(...AUTH());
    expect(res.status).toBe(403);
  });
});

describe('POST /api/programs/:id/copy', () => {
  it('201: копия готовой программы в аккаунте (транзакция)', async () => {
    const shared = makeExercise();
    const source = makeProgram([makePe(shared)], { userId: null, id: 60, name: 'Готовая' });
    repo.findProgramById
      .mockResolvedValueOnce(source as never)
      .mockResolvedValueOnce(makeProgram([makePe(shared, { programId: 99 })], { id: 99, userId: USER, name: 'Готовая' }) as never);
    repo.createProgram.mockResolvedValue({ id: 99, userId: USER, name: 'Готовая', description: null, place: 'home', isActive: true, createdAt: now, updatedAt: now } as never);
    repo.createProgramExercise.mockResolvedValue(makePe(shared, { programId: 99 }) as never);

    const res = await request(app).post('/api/programs/60/copy').set(...AUTH());
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(USER);
    expect(res.body.exercises).toHaveLength(1);
    expect(repo.createProgramExercise).toHaveBeenCalledWith(
      expect.objectContaining({ programId: 99, exerciseId: shared.id, order: 1 }),
      expect.anything(),
    );
  });

  it('403: источник содержит чужое персональное упражнение — копия не создаётся', async () => {
    const foreign = makeExercise({ id: 102, userId: OTHER });
    repo.findProgramById.mockResolvedValue(makeProgram([makePe(foreign)], { userId: OTHER, id: 60 }) as never);
    const res = await request(app).post('/api/programs/60/copy').set(...AUTH());
    expect(res.status).toBe(403);
    expect(repo.createProgram).not.toHaveBeenCalled();
  });
});

describe('POST /api/programs/:id/exercises', () => {
  it('201: добавление в конец (order = max+1)', async () => {
    const shared = makeExercise();
    repo.findProgramById.mockResolvedValue(makeProgram([makePe(shared)], { userId: USER }) as never);
    exRepo.findExerciseById.mockResolvedValue(shared as never);
    repo.findMaxProgramExerciseOrder.mockResolvedValue(1);
    repo.findProgramExerciseByOrder.mockResolvedValue(null);
    repo.createProgramExercise.mockResolvedValue(makePe(shared, { order: 2 }) as never);

    const res = await request(app).post('/api/programs/50/exercises').set(...AUTH())
      .send({ exerciseId: 100, targetSets: 3, targetReps: 10 });
    expect(res.status).toBe(201);
    expect(res.body.order).toBe(2);
  });

  it('400: цели не соответствуют метрике; позиция занята', async () => {
    const shared = makeExercise();
    repo.findProgramById.mockResolvedValue(makeProgram([makePe(shared)], { userId: USER }) as never);
    exRepo.findExerciseById.mockResolvedValue(shared as never);

    const wrongTargets = await request(app).post('/api/programs/50/exercises').set(...AUTH())
      .send({ exerciseId: 100, targetSets: 3, targetReps: 10, targetWeight: 40 });
    expect(wrongTargets.status).toBe(400);
    expect(wrongTargets.body.error.code).toBe('VALIDATION_ERROR');

    exRepo.findExerciseById.mockResolvedValue(shared as never);
    repo.findMaxProgramExerciseOrder.mockResolvedValue(1);
    repo.findProgramExerciseByOrder.mockResolvedValue(makePe(shared) as never);
    const occupied = await request(app).post('/api/programs/50/exercises').set(...AUTH())
      .send({ exerciseId: 100, targetSets: 3, targetReps: 10, order: 1 });
    expect(occupied.status).toBe(400);
  });

  it('403: чужое персональное упражнение', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: USER }) as never);
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ id: 102, userId: OTHER }) as never);
    const res = await request(app).post('/api/programs/50/exercises').set(...AUTH())
      .send({ exerciseId: 102, targetSets: 3, targetReps: 10 });
    expect(res.status).toBe(403);
  });

  it('201: перерыв между подходами передаётся в репозиторий', async () => {
    const shared = makeExercise();
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: USER }) as never);
    exRepo.findExerciseById.mockResolvedValue(shared as never);
    repo.findMaxProgramExerciseOrder.mockResolvedValue(0);
    repo.findProgramExerciseByOrder.mockResolvedValue(null);
    repo.createProgramExercise.mockResolvedValue(makePe(shared, { restSec: 45 }) as never);

    const res = await request(app).post('/api/programs/50/exercises').set(...AUTH())
      .send({ exerciseId: 100, targetSets: 3, targetReps: 10, restSec: 45 });
    expect(res.status).toBe(201);
    expect(res.body.restSec).toBe(45);
    expect(repo.createProgramExercise).toHaveBeenCalledWith(
      expect.objectContaining({ restSec: 45 }),
    );
  });
});

describe('PUT /api/programs/:id/exercises/:programExerciseId', () => {
  it('200: изменение целей', async () => {
    const shared = makeExercise();
    repo.findProgramById.mockResolvedValue(makeProgram([makePe(shared)], { userId: USER }) as never);
    repo.findProgramExerciseById.mockResolvedValue(makePe(shared) as never);
    repo.updateProgramExercise.mockResolvedValue(makePe(shared, { targetSets: 4 }) as never);
    const res = await request(app).put('/api/programs/50/exercises/500').set(...AUTH()).send({ targetSets: 4 });
    expect(res.status).toBe(200);
    expect(res.body.targetSets).toBe(4);
  });

  it('404: строка состава из другой программы', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: USER }) as never);
    repo.findProgramExerciseById.mockResolvedValue(makePe(makeExercise(), { programId: 999 }) as never);
    const res = await request(app).put('/api/programs/50/exercises/500').set(...AUTH()).send({ targetSets: 4 });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/programs/:id/exercises/order', () => {
  it('200: пакетная перестановка', async () => {
    const ex1 = makeExercise();
    const ex2 = makeExercise({ id: 101 });
    const rows = [makePe(ex1, { id: 501, order: 1 }), makePe(ex2, { id: 502, order: 2 })];
    repo.findProgramById.mockResolvedValue(makeProgram(rows, { userId: USER }) as never);
    repo.updateProgramExerciseOrder.mockResolvedValue({} as never);

    const res = await request(app).put('/api/programs/50/exercises/order').set(...AUTH())
      .send({ orders: [{ programExerciseId: 502, order: 1 }, { programExerciseId: 501, order: 2 }] });
    expect(res.status).toBe(200);
    expect(repo.updateProgramExerciseOrder).toHaveBeenCalledTimes(4); // 2 фазы × 2 строки
  });

  it('400: неполный набор / дубликаты позиций', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: USER }) as never);
    const incomplete = await request(app).put('/api/programs/50/exercises/order').set(...AUTH())
      .send({ orders: [{ programExerciseId: 501, order: 1 }] });
    expect(incomplete.status).toBe(400);
  });
});

describe('DELETE /api/programs/:id/exercises/:programExerciseId', () => {
  it('204: удаление с нормализацией порядка', async () => {
    const ex = makeExercise();
    const rows = [makePe(ex, { id: 501, order: 1 }), makePe(ex, { id: 502, order: 2 })];
    repo.findProgramById.mockResolvedValue(makeProgram(rows, { userId: USER }) as never);
    repo.findProgramExerciseById.mockResolvedValue(rows[0] as never);
    repo.deleteProgramExercise.mockResolvedValue(rows[0] as never);
    repo.listProgramExercises.mockResolvedValue([rows[1]]);
    repo.updateProgramExerciseOrder.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/programs/50/exercises/501').set(...AUTH());
    expect(res.status).toBe(204);
    expect(repo.updateProgramExerciseOrder).toHaveBeenCalledWith(502, 1, expect.anything());
  });
});
