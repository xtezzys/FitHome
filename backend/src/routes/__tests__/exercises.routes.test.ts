import { beforeEach, describe, expect, it, vi } from 'vitest';

// Repositories мокаются: тестируем HTTP-контракты docs/api.md §3 (этап 3)
vi.mock('../../repositories/exercise.repository.js', () => ({
  listExercises: vi.fn(),
  findExerciseById: vi.fn(),
  findPersonalByNameLower: vi.fn(),
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
}));

import request from 'supertest';
import { createApp } from '../../app.js';
import * as exerciseRepo from '../../repositories/exercise.repository.js';
import { signAccessToken } from '../../lib/jwt.js';

const repo = vi.mocked(exerciseRepo);
const app = createApp();
const AUTH = (): [string, string] => ['Authorization', `Bearer ${signAccessToken(1)}`];
const now = new Date('2026-11-11T10:00:00.000Z');
const USER = 1;
const OTHER = 2;

function makeExercise(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    name: 'Отжимания',
    nameLower: 'отжимания',
    description: 'Классические отжимания',
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

// resetAllMocks: убирает и implementation — моки не «протекают» между тестами
beforeEach(() => {
  vi.resetAllMocks();
});

describe('Авторизация /api/exercises', () => {
  it('401 UNAUTHORIZED без токена на все эндпоинты', async () => {
    for (const action of [
      () => request(app).get('/api/exercises'),
      () => request(app).get('/api/exercises/10'),
      () => request(app).post('/api/exercises').send({}),
      () => request(app).put('/api/exercises/10').send({}),
      () => request(app).delete('/api/exercises/10'),
    ]) {
      const res = await action();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('GET /api/exercises', () => {
  it('200: { data, meta } с массивами muscleGroups/equipment', async () => {
    repo.listExercises.mockResolvedValue([[makeExercise()], 34]);
    const res = await request(app).get('/api/exercises').set(...AUTH());
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 34 });
    expect(res.body.data[0]).toMatchObject({
      id: 10,
      name: 'Отжимания',
      muscleGroups: ['chest', 'triceps'],
      equipment: [],
      difficulty: 'easy',
      userId: null,
    });
  });

  it('пагинация: page/limit передаются в репозиторий, limit > 100 → 400', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    const ok = await request(app).get('/api/exercises?page=2&limit=50').set(...AUTH());
    expect(ok.status).toBe(200);
    expect(repo.listExercises).toHaveBeenCalledWith(expect.anything(), 2, 50);

    const bad = await request(app).get('/api/exercises?limit=101').set(...AUTH());
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('поиск по кириллице регистронезависим: search=ОТЖИМ → contains «отжим»', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    const res = await request(app).get('/api/exercises?search=ОТЖИМ').set(...AUTH());
    expect(res.status).toBe(200);
    const [where] = repo.listExercises.mock.calls[0];
    expect(where.nameLower).toEqual({ contains: 'отжим' });
  });

  it('CSV-фильтры — точное совпадение целого токена (",chest,")', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await request(app).get('/api/exercises?muscle=chest,triceps&equipment=dumbbell').set(...AUTH());
    const [where] = repo.listExercises.mock.calls[0];
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({
      OR: [{ muscleGroups: { contains: ',chest,' } }, { muscleGroups: { contains: ',triceps,' } }],
    });
    expect(and).toContainEqual({ OR: [{ equipment: { contains: ',dumbbell,' } }] });
  });

  it('неизвестный токен фильтра → 400', async () => {
    const res = await request(app).get('/api/exercises?muscle=nope').set(...AUTH());
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('недопустимое место → 400', async () => {
    const res = await request(app).get('/api/exercises?place=office').set(...AUTH());
    expect(res.status).toBe(400);
  });
});

describe('GET /api/exercises/:id', () => {
  it('200: общее упражнение', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise() as never);
    const res = await request(app).get('/api/exercises/10').set(...AUTH());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
  });

  it('404 не найдено; 403 чужое персональное', async () => {
    repo.findExerciseById.mockResolvedValue(null);
    const notFound = await request(app).get('/api/exercises/999').set(...AUTH());
    expect(notFound.status).toBe(404);

    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: OTHER }) as never);
    const forbidden = await request(app).get('/api/exercises/10').set(...AUTH());
    expect(forbidden.status).toBe(403);
  });
});

describe('POST /api/exercises', () => {
  it('201: создаёт персональное упражнение (userId из токена)', async () => {
    repo.findPersonalByNameLower.mockResolvedValue(null);
    repo.createExercise.mockResolvedValue(makeExercise({ userId: USER, name: 'Моё упражнение', nameLower: 'моё упражнение' }) as never);
    const res = await request(app).post('/api/exercises').set(...AUTH()).send({
      name: 'Моё упражнение',
      place: 'home',
      metric: 'reps',
      muscleGroups: ['chest'],
      difficulty: 'medium',
      equipment: ['dumbbell'],
    });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(USER);
    expect(repo.createExercise).toHaveBeenCalledWith(
      expect.objectContaining({ nameLower: 'моё упражнение', equipment: ',dumbbell,', userId: USER }),
    );
  });

  it('400 при невалидных полях (нет name / неизвестная сложность / пустые muscleGroups)', async () => {
    for (const body of [
      { place: 'home', metric: 'reps', muscleGroups: ['chest'], difficulty: 'easy' },
      { name: 'X', place: 'home', metric: 'reps', muscleGroups: ['chest'], difficulty: 'impossible' },
      { name: 'X', place: 'home', metric: 'reps', muscleGroups: [], difficulty: 'easy' },
      { name: 'X', place: 'home', metric: 'reps', muscleGroups: ['chest'] },
    ]) {
      const res = await request(app).post('/api/exercises').set(...AUTH()).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(repo.createExercise).not.toHaveBeenCalled();
  });

  it('409 CONFLICT: дубликат имени у пользователя', async () => {
    repo.findPersonalByNameLower.mockResolvedValue(makeExercise({ userId: USER }) as never);
    const res = await request(app).post('/api/exercises').set(...AUTH()).send({
      name: 'Отжимания',
      place: 'home',
      metric: 'reps',
      muscleGroups: ['chest'],
      difficulty: 'easy',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('PUT /api/exercises/:id', () => {
  it('200: обновление своего упражнения', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: USER }) as never);
    repo.findPersonalByNameLower.mockResolvedValue(null);
    repo.updateExercise.mockResolvedValue(makeExercise({ userId: USER, difficulty: 'medium' }) as never);
    const res = await request(app).put('/api/exercises/10').set(...AUTH()).send({ difficulty: 'medium' });
    expect(res.status).toBe(200);
    expect(res.body.difficulty).toBe('medium');
  });

  it('403: общее и чужое персональное', async () => {
    repo.findExerciseById.mockResolvedValueOnce(makeExercise({ userId: null }) as never);
    const shared = await request(app).put('/api/exercises/10').set(...AUTH()).send({ name: 'X' });
    expect(shared.status).toBe(403);

    repo.findExerciseById.mockResolvedValueOnce(makeExercise({ userId: OTHER }) as never);
    const foreign = await request(app).put('/api/exercises/10').set(...AUTH()).send({ name: 'X' });
    expect(foreign.status).toBe(403);
  });
});

describe('DELETE /api/exercises/:id', () => {
  it('204: удаление своего упражнения', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: USER }) as never);
    repo.deleteExercise.mockResolvedValue(makeExercise({ userId: USER }) as never);
    const res = await request(app).delete('/api/exercises/10').set(...AUTH());
    expect(res.status).toBe(204);
  });

  it('409 CONFLICT: упражнение используется (P2003 → Restrict)', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: USER }) as never);
    repo.deleteExercise.mockRejectedValue({ code: 'P2003' });
    const res = await request(app).delete('/api/exercises/10').set(...AUTH());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('403: общее упражнение удалить нельзя', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: null }) as never);
    const res = await request(app).delete('/api/exercises/10').set(...AUTH());
    expect(res.status).toBe(403);
  });
});
