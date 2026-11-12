import { beforeEach, describe, expect, it, vi } from 'vitest';

// Repositories мокаются целиком: тестируем бизнес-логику services
vi.mock('../../repositories/exercise.repository.js', () => ({
  listExercises: vi.fn(),
  findExerciseById: vi.fn(),
  findPersonalByNameLower: vi.fn(),
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
}));

import * as exerciseRepo from '../../repositories/exercise.repository.js';
import * as exerciseService from '../exercise.service.js';
import { AppError } from '../../types/errors.js';

const repo = vi.mocked(exerciseRepo);

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exercise.service — listExercises', () => {
  it('строит where видимости: общие + персональные пользователя', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await exerciseService.listExercises(USER, { page: 1, limit: 20, scope: 'all' });
    const [where] = repo.listExercises.mock.calls[0];
    expect(where.AND).toContainEqual({ OR: [{ userId: null }, { userId: USER }] });
  });

  it('CSV-фильтр мышцы — точное совпадение целого токена (",chest,", не "chest,")', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await exerciseService.listExercises(USER, { page: 1, limit: 20, scope: 'all', muscle: ['chest'] });
    const [where] = repo.listExercises.mock.calls[0];
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ OR: [{ muscleGroups: { contains: ',chest,' } }] });
  });

  it('несколько мышц — any-match (OR внутри AND-группы)', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await exerciseService.listExercises(USER, { page: 1, limit: 20, scope: 'all', muscle: ['chest', 'back'] });
    const [where] = repo.listExercises.mock.calls[0];
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({
      OR: [{ muscleGroups: { contains: ',chest,' } }, { muscleGroups: { contains: ',back,' } }],
    });
  });

  it('поиск нормализует регистр кириллицы: «ОТЖИМ» → nameLower contains «отжим»', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await exerciseService.listExercises(USER, { page: 1, limit: 20, scope: 'all', search: 'ОТЖИМ' });
    const [where] = repo.listExercises.mock.calls[0];
    expect(where.nameLower).toEqual({ contains: 'отжим' });
  });

  it('scope=shared: видимость только общие упражнения (userId = null)', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await exerciseService.listExercises(USER, { page: 1, limit: 20, scope: 'shared' });
    const [where] = repo.listExercises.mock.calls[0];
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ userId: null });
    expect(JSON.stringify(and)).not.toContain(JSON.stringify([{ userId: null }, { userId: USER }]));
  });

  it('scope=mine: видимость только персональные упражнения пользователя', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await exerciseService.listExercises(USER, { page: 1, limit: 20, scope: 'mine' });
    const [where] = repo.listExercises.mock.calls[0];
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ userId: USER });
    expect(JSON.stringify(and)).not.toContain('{\"userId\":null}');
  });

  it('scope=all: общие + персональные (по умолчанию)', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await exerciseService.listExercises(USER, { page: 1, limit: 20, scope: 'all' });
    const [where] = repo.listExercises.mock.calls[0];
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ OR: [{ userId: null }, { userId: USER }] });
  });

  it('scope=mine в сочетании с фильтром мышцы', async () => {
    repo.listExercises.mockResolvedValue([[], 0]);
    await exerciseService.listExercises(USER, { page: 1, limit: 20, scope: 'mine', muscle: ['chest'] });
    const [where] = repo.listExercises.mock.calls[0];
    const and = where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ userId: USER });
    expect(and).toContainEqual({ OR: [{ muscleGroups: { contains: ',chest,' } }] });
  });

  it('возвращает DTO с массивами токенов и meta пагинации', async () => {
    repo.listExercises.mockResolvedValue([[makeExercise()], 34]);
    const result = await exerciseService.listExercises(USER, { page: 2, limit: 20, scope: 'all', place: 'home', difficulty: 'easy', metric: 'reps' });
    expect(result.data[0].muscleGroups).toEqual(['chest', 'triceps']);
    expect(result.data[0].equipment).toEqual([]);
    expect(result.meta).toEqual({ page: 2, limit: 20, total: 34 });
  });
});

describe('exercise.service — getExercise', () => {
  it('общее упражнение доступно всем', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise() as never);
    const dto = await exerciseService.getExercise(USER, 10);
    expect(dto.id).toBe(10);
  });

  it('чужое персональное → 403', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: OTHER }) as never);
    await expect(exerciseService.getExercise(USER, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('несуществующее → 404', async () => {
    repo.findExerciseById.mockResolvedValue(null);
    await expect(exerciseService.getExercise(USER, 999)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('exercise.service — createExercise', () => {
  it('создаёт с nameLower и каноническим CSV; кириллица корректна', async () => {
    repo.findPersonalByNameLower.mockResolvedValue(null);
    repo.createExercise.mockResolvedValue(
      makeExercise({ name: 'Тяга резинки', nameLower: 'тяга резинки', muscleGroups: ',back,biceps,', equipment: ',resistance_band,', userId: USER }) as never,
    );
    const dto = await exerciseService.createExercise(USER, {
      name: 'Тяга Резинки',
      place: 'home',
      metric: 'reps',
      muscleGroups: ['back', 'biceps'],
      difficulty: 'easy',
      equipment: ['resistance_band'],
    });
    expect(repo.createExercise).toHaveBeenCalledWith(
      expect.objectContaining({
        nameLower: 'тяга резинки',
        muscleGroups: ',back,biceps,',
        equipment: ',resistance_band,',
        userId: USER,
      }),
    );
    expect(dto.userId).toBe(USER);
  });

  it('пустой equipment сохраняется как null', async () => {
    repo.findPersonalByNameLower.mockResolvedValue(null);
    repo.createExercise.mockResolvedValue(makeExercise({ userId: USER }) as never);
    await exerciseService.createExercise(USER, {
      name: 'Отжимания с опорой',
      place: 'home',
      metric: 'reps',
      muscleGroups: ['chest'],
      difficulty: 'easy',
      equipment: [],
    });
    expect(repo.createExercise).toHaveBeenCalledWith(expect.objectContaining({ equipment: null }));
  });

  it('дубликат имени у пользователя → 409', async () => {
    repo.findPersonalByNameLower.mockResolvedValue(makeExercise({ userId: USER }) as never);
    await expect(
      exerciseService.createExercise(USER, {
        name: 'Отжимания',
        place: 'home',
        metric: 'reps',
        muscleGroups: ['chest'],
        difficulty: 'easy',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('одно имя с общим упражнением разрешено (уникальность только в рамках пользователя)', async () => {
    repo.findPersonalByNameLower.mockResolvedValue(null);
    repo.createExercise.mockResolvedValue(makeExercise({ userId: USER }) as never);
    await expect(
      exerciseService.createExercise(USER, {
        name: 'Отжимания',
        place: 'home',
        metric: 'reps',
        muscleGroups: ['chest'],
        difficulty: 'easy',
      }),
    ).resolves.toBeTruthy();
  });
});

describe('exercise.service — updateExercise', () => {
  it('общее упражнение → 403 (изменять нельзя)', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: null }) as never);
    await expect(exerciseService.updateExercise(USER, 10, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('чужое персональное → 403', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: OTHER }) as never);
    await expect(exerciseService.updateExercise(USER, 10, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('переименование с проверкой уникальности (исключая себя)', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: USER }) as never);
    repo.findPersonalByNameLower.mockResolvedValue(null);
    repo.updateExercise.mockResolvedValue(makeExercise({ name: 'Отжимания с опорой', nameLower: 'отжимания с опорой', userId: USER }) as never);
    await exerciseService.updateExercise(USER, 10, { name: 'Отжимания с опорой' });
    expect(repo.updateExercise).toHaveBeenCalledWith(10, { name: 'Отжимания с опорой', nameLower: 'отжимания с опорой' });
    expect(repo.findPersonalByNameLower).toHaveBeenCalledWith(USER, 'отжимания с опорой', 10);
  });
});

describe('exercise.service — deleteExercise', () => {
  it('чужое/общее → 403', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: null }) as never);
    await expect(exerciseService.deleteExercise(USER, 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('P2003 (Restrict) → 409 CONFLICT', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: USER }) as never);
    repo.deleteExercise.mockRejectedValue({ code: 'P2003' });
    await expect(exerciseService.deleteExercise(USER, 10)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('успешное удаление своего упражнения', async () => {
    repo.findExerciseById.mockResolvedValue(makeExercise({ userId: USER }) as never);
    repo.deleteExercise.mockResolvedValue(makeExercise({ userId: USER }) as never);
    await expect(exerciseService.deleteExercise(USER, 10)).resolves.toBeUndefined();
  });
});

describe('exercise.service — типы ошибок', () => {
  it('ошибки — AppError с корректными кодами', async () => {
    repo.findExerciseById.mockResolvedValue(null);
    const err = await exerciseService.getExercise(USER, 999).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
  });
});
