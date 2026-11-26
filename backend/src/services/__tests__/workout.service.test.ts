import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Repositories мокаются: тестируем бизнес-правила сервиса тренировок (docs/api.md §5).
// Форма P2002 воспроизводит фактический вывод эксперимента на временной SQLite-БД
// (Prisma 6.19.3: meta = { modelName: 'Workout', target: ['userId'] }).
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

import * as workoutRepo from '../../repositories/workout.repository.js';
import * as programRepo from '../../repositories/program.repository.js';
import * as exerciseRepo from '../../repositories/exercise.repository.js';
import * as workoutService from '../workout.service.js';

const repo = vi.mocked(workoutRepo);
const progRepo = vi.mocked(programRepo);
const exRepo = vi.mocked(exerciseRepo);

const USER = 2;
const OTHER = 99;
const now = new Date('2026-11-12T18:00:00.000Z');

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

function makePe(exercise = makeExercise(), overrides: Partial<Record<string, unknown>> = {}) {
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

function makeProgram(exercises = [makePe()], overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 50,
    userId: USER,
    name: 'Моя программа',
    description: null,
    place: 'home',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    exercises,
    ...overrides,
  };
}

function makeResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    workoutId: 7,
    exerciseId: 10,
    programExerciseId: 500,
    exerciseName: 'Отжимания',
    exerciseMetric: 'reps',
    order: 1,
    skipped: false,
    notes: null,
    createdAt: now,
    sets: [],
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

/** Строка истории: агрегаты репозитория (_count) вместо загрузки подходов. */
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

/** tx-заглушка: runTransaction выполняет колбэк с ней; репозитории замоканы. */
function mockTransaction(): Record<string, never> {
  const tx = {} as Record<string, never>;
  repo.runTransaction.mockImplementation(async (fn) => fn(tx as never));
  return tx;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('startWorkout — свободная тренировка', () => {
  it('создаёт пустую тренировку без результатов и возвращает DTO', async () => {
    mockTransaction();
    repo.findActiveByUser.mockResolvedValue(null);
    repo.createWorkout.mockResolvedValue({ id: 7 } as never);
    repo.findWorkoutById.mockResolvedValue(makeWorkout() as never);

    const dto = await workoutService.startWorkout(USER, { place: 'home' });

    expect(repo.createWorkout).toHaveBeenCalledWith(
      { userId: USER, programId: null, programName: null, place: 'home' },
      expect.anything(),
    );
    expect(repo.createWorkoutResult).not.toHaveBeenCalled();
    expect(progRepo.findProgramById).not.toHaveBeenCalled();
    expect(dto).toMatchObject({ id: 7, userId: USER, status: 'in_progress', revision: 0, results: [] });
    expect(dto.startedAt).toBe(now.toISOString());
  });

  it('уже есть активная тренировка → 409, транзакция не открывается', async () => {
    repo.findActiveByUser.mockResolvedValue(makeWorkout({ id: 42 }) as never);

    await expect(workoutService.startWorkout(USER, { place: 'home' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('id=42'),
    });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });
});

describe('startWorkout — по программе', () => {
  it('своя программа: снапшоты названия программы и упражнений, programExerciseId', async () => {
    mockTransaction();
    const ex1 = makeExercise({ id: 10, name: 'Отжимания', metric: 'reps' });
    const ex2 = makeExercise({ id: 11, name: 'Приседания', metric: 'reps_weight' });
    const program = makeProgram([makePe(ex1, { id: 500, order: 1 }), makePe(ex2, { id: 501, order: 2 })]);
    repo.findActiveByUser.mockResolvedValue(null);
    progRepo.findProgramById.mockResolvedValue(program as never);
    repo.createWorkout.mockResolvedValue({ id: 7 } as never);
    repo.findWorkoutById.mockResolvedValue(
      makeWorkout({
        programId: 50,
        programName: 'Моя программа',
        results: [
          makeResult({ id: 100, order: 1, exerciseId: 10, programExerciseId: 500, exerciseName: 'Отжимания', exerciseMetric: 'reps' }),
          makeResult({ id: 101, order: 2, exerciseId: 11, programExerciseId: 501, exerciseName: 'Приседания', exerciseMetric: 'reps_weight' }),
        ],
      }) as never,
    );

    const dto = await workoutService.startWorkout(USER, { place: 'home', programId: 50 });

    expect(repo.createWorkout).toHaveBeenCalledWith(
      { userId: USER, programId: 50, programName: 'Моя программа', place: 'home' },
      expect.anything(),
    );
    expect(repo.createWorkoutResult).toHaveBeenCalledTimes(2);
    expect(repo.createWorkoutResult).toHaveBeenNthCalledWith(
      1,
      {
        workoutId: 7,
        exerciseId: 10,
        programExerciseId: 500,
        exerciseName: 'Отжимания',
        exerciseMetric: 'reps',
        order: 1,
      },
      expect.anything(),
    );
    expect(repo.createWorkoutResult).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ exerciseId: 11, programExerciseId: 501, exerciseName: 'Приседания', exerciseMetric: 'reps_weight', order: 2 }),
      expect.anything(),
    );
    expect(dto.programName).toBe('Моя программа');
    expect(dto.results).toHaveLength(2);
    expect(dto.results[0]).toMatchObject({ programExerciseId: 500, exerciseName: 'Отжимания', sets: [] });
  });

  it('готовая программа (userId=null) доступна пользователю', async () => {
    mockTransaction();
    progRepo.findProgramById.mockResolvedValue(makeProgram([makePe()], { userId: null, name: 'Готовая' }) as never);
    repo.findActiveByUser.mockResolvedValue(null);
    repo.createWorkout.mockResolvedValue({ id: 7 } as never);
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ programId: 50, programName: 'Готовая' }) as never);

    await workoutService.startWorkout(USER, { place: 'home', programId: 50 });
    expect(repo.createWorkoutResult).toHaveBeenCalledTimes(1);
  });

  it('чужая персональная программа → 404 (без раскрытия существования)', async () => {
    progRepo.findProgramById.mockResolvedValue(makeProgram([], { userId: OTHER }) as never);

    await expect(workoutService.startWorkout(USER, { place: 'home', programId: 50 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Программа не найдена',
    });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });

  it('несуществующая программа → 404', async () => {
    progRepo.findProgramById.mockResolvedValue(null);
    await expect(workoutService.startWorkout(USER, { place: 'home', programId: 999 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('чужое персональное упражнение в программе → 404, тренировка откатывается', async () => {
    mockTransaction();
    const foreign = makeExercise({ id: 12, userId: OTHER });
    progRepo.findProgramById.mockResolvedValue(makeProgram([makePe(foreign)], { userId: USER }) as never);
    repo.findActiveByUser.mockResolvedValue(null);
    repo.createWorkout.mockResolvedValue({ id: 7 } as never);

    await expect(workoutService.startWorkout(USER, { place: 'home', programId: 50 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Упражнение не найдено',
    });
    // createWorkout выполнен внутри tx, но наружу уходит ошибка —
    // транзакция в Prisma откатит создание тренировки
    expect(repo.findWorkoutById).not.toHaveBeenCalled();
  });
});

describe('startWorkout — конкурентный конфликт P2002', () => {
  it('P2002 формы Workout/userId → 409 с id победившей активной тренировки', async () => {
    repo.runTransaction.mockRejectedValue({
      code: 'P2002',
      meta: { modelName: 'Workout', target: ['userId'] },
    });
    repo.findActiveByUser
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeWorkout({ id: 77 }) as never);

    await expect(workoutService.startWorkout(USER, { place: 'home' })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('id=77'),
    });
  });

  it('P2002 другой модели/констрейнта не маскируется в 409', async () => {
    const foreignError = {
      code: 'P2002',
      meta: { modelName: 'Exercise', target: ['userId', 'name'] },
    };
    repo.runTransaction.mockRejectedValue(foreignError);

    await expect(workoutService.startWorkout(USER, { place: 'home' })).rejects.toBe(foreignError);
  });
});

describe('getActiveWorkout', () => {
  it('возвращает активную тренировку с результатами и подходами', async () => {
    const set = { id: 900, workoutResultId: 100, order: 1, reps: 12, weight: null, duration: null, skipped: false };
    repo.findActiveByUser.mockResolvedValue(
      makeWorkout({ results: [makeResult({ sets: [set] })] }) as never,
    );

    const dto = await workoutService.getActiveWorkout(USER);

    expect(dto.id).toBe(7);
    expect(dto.results[0].sets).toEqual([
      { id: 900, order: 1, reps: 12, weight: null, duration: null, skipped: false },
    ]);
  });

  it('активной тренировки нет → 404', async () => {
    repo.findActiveByUser.mockResolvedValue(null);
    await expect(workoutService.getActiveWorkout(USER)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Активная тренировка не найдена',
    });
  });

  it('Decimal weight конвертируется в число в DTO', async () => {
    const set = { id: 901, workoutResultId: 100, order: 2, reps: 10, weight: '40.5', duration: null, skipped: false };
    repo.findActiveByUser.mockResolvedValue(makeWorkout({ results: [makeResult({ sets: [set] })] }) as never);
    const dto = await workoutService.getActiveWorkout(USER);
    expect(dto.results[0].sets[0].weight).toBe(40.5);
  });
});

describe('saveWorkoutResults — успешная полная замена', () => {
  it('программная: снапшоты из ProgramExercise, CAS и запись в одном tx', async () => {
    const tx = mockTransaction();
    const exercise = makeExercise({ id: 10, name: 'Жим', metric: 'reps_weight' });
    const pe = makePe(exercise, { id: 500, programId: 50, exerciseId: 10 });
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ programId: 50, revision: 2 }) as never)
      .mockResolvedValueOnce(
        makeWorkout({
          programId: 50,
          revision: 3,
          results: [
            makeResult({
              exerciseId: 10,
              programExerciseId: 500,
              exerciseName: 'Жим',
              exerciseMetric: 'reps_weight',
              notes: 'норм',
              sets: [
                { id: 900, workoutResultId: 100, order: 1, reps: 10, weight: 40, duration: null, skipped: false },
              ],
            }),
          ],
        }) as never,
      );
    progRepo.findProgramExerciseById.mockResolvedValue(pe as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);
    repo.createWorkoutResult.mockResolvedValue({ id: 101 } as never);
    repo.createWorkoutSets.mockResolvedValue({ count: 2 } as never);

    const dto = await workoutService.saveWorkoutResults(USER, 7, {
      revision: 2,
      results: [
        {
          order: 1,
          notes: 'норм',
          programExerciseId: 500,
          sets: [
            { order: 1, reps: 10, weight: 40 },
            { order: 2, skipped: true },
          ],
        },
      ],
    });

    expect(progRepo.findProgramExerciseById).toHaveBeenCalledWith(500);
    expect(repo.casUpdateWorkout).toHaveBeenCalledWith(
      { id: 7, userId: USER, status: 'in_progress', revision: 2 },
      {},
      tx,
    );
    expect(repo.deleteWorkoutResults).toHaveBeenCalledWith(7, tx);
    expect(repo.createWorkoutResult).toHaveBeenCalledWith(
      {
        workoutId: 7,
        exerciseId: 10,
        programExerciseId: 500,
        exerciseName: 'Жим',
        exerciseMetric: 'reps_weight',
        order: 1,
        skipped: false,
        notes: 'норм',
      },
      tx,
    );
    expect(repo.createWorkoutSets).toHaveBeenCalledWith(
      101,
      [
        { order: 1, reps: 10, weight: 40, duration: null, skipped: false },
        { order: 2, reps: null, weight: null, duration: null, skipped: true },
      ],
      tx,
    );
    expect(dto.revision).toBe(3);
    expect(dto.results[0].exerciseMetric).toBe('reps_weight');
  });

  it('свободная: снапшоты из Exercise, метрика time', async () => {
    const tx = mockTransaction();
    const exercise = makeExercise({ id: 11, name: 'Планка', metric: 'time', userId: USER });
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout() as never)
      .mockResolvedValueOnce(
        makeWorkout({
          revision: 1,
          results: [
            makeResult({
              exerciseId: 11,
              programExerciseId: null,
              exerciseName: 'Планка',
              exerciseMetric: 'time',
              sets: [{ id: 901, workoutResultId: 100, order: 1, reps: null, weight: null, duration: 60, skipped: false }],
            }),
          ],
        }) as never,
      );
    exRepo.findExerciseById.mockResolvedValue(exercise as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);
    repo.createWorkoutResult.mockResolvedValue({ id: 102 } as never);
    repo.createWorkoutSets.mockResolvedValue({ count: 1 } as never);

    const dto = await workoutService.saveWorkoutResults(USER, 7, {
      revision: 0,
      results: [{ order: 1, exerciseId: 11, sets: [{ order: 1, duration: 60 }] }],
    });

    expect(repo.createWorkoutResult).toHaveBeenCalledWith(
      {
        workoutId: 7,
        exerciseId: 11,
        programExerciseId: null,
        exerciseName: 'Планка',
        exerciseMetric: 'time',
        order: 1,
        skipped: false,
        notes: null,
      },
      tx,
    );
    expect(repo.createWorkoutSets).toHaveBeenCalledWith(
      102,
      [{ order: 1, reps: null, weight: null, duration: 60, skipped: false }],
      tx,
    );
    expect(dto.results[0].exerciseName).toBe('Планка');
  });

  it('results: [] — удаляет старые результаты, новых не создаёт', async () => {
    const tx = mockTransaction();
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ revision: 4 }) as never)
      .mockResolvedValueOnce(makeWorkout({ revision: 5 }) as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);

    const dto = await workoutService.saveWorkoutResults(USER, 7, { revision: 4, results: [] });

    expect(repo.deleteWorkoutResults).toHaveBeenCalledWith(7, tx);
    expect(repo.createWorkoutResult).not.toHaveBeenCalled();
    expect(repo.createWorkoutSets).not.toHaveBeenCalled();
    expect(dto.results).toEqual([]);
  });
});

describe('saveWorkoutResults — валидация', () => {
  beforeEach(() => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout() as never);
  });

  it('нарушение непрерывности order результатов → 400', async () => {
    await expect(
      workoutService.saveWorkoutResults(USER, 7, {
        revision: 0,
        results: [
          { order: 1, exerciseId: 10, sets: [] },
          { order: 3, exerciseId: 11, sets: [] },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('результатов'),
    });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });

  it('нарушение непрерывности order подходов → 400', async () => {
    await expect(
      workoutService.saveWorkoutResults(USER, 7, {
        revision: 0,
        results: [
          {
            order: 1,
            exerciseId: 10,
            sets: [
              { order: 1, reps: 5 },
              { order: 3, reps: 5 },
            ],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('подходов'),
    });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });

  it('подход без обязательного для метрики поля → 400', async () => {
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ metric: 'reps' }) as never);
    await expect(
      workoutService.saveWorkoutResults(USER, 7, {
        revision: 0,
        results: [{ order: 1, exerciseId: 10, sets: [{ order: 1, weight: 20 }] }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('reps'),
    });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });

  it('exerciseId в программной тренировке → 400', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ programId: 50 }) as never);
    await expect(
      workoutService.saveWorkoutResults(USER, 7, {
        revision: 0,
        results: [{ order: 1, programExerciseId: 500, exerciseId: 10, sets: [] }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('exerciseId'),
    });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });
});

describe('saveWorkoutResults — доступ и статус', () => {
  it('несуществующая тренировка → 404', async () => {
    repo.findWorkoutById.mockResolvedValue(null);
    await expect(
      workoutService.saveWorkoutResults(USER, 7, { revision: 0, results: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Тренировка не найдена' });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });

  it('чужая тренировка → 404 (без раскрытия существования)', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ userId: OTHER }) as never);
    await expect(
      workoutService.saveWorkoutResults(USER, 7, { revision: 0, results: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Тренировка не найдена' });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });

  it('статус completed → 409 без открытия транзакции', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'completed' }) as never);
    await expect(
      workoutService.saveWorkoutResults(USER, 7, { revision: 0, results: [] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });

  it('недоступное персональное упражнение в свободной → 404', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout() as never);
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ userId: OTHER }) as never);
    await expect(
      workoutService.saveWorkoutResults(USER, 7, {
        revision: 0,
        results: [{ order: 1, exerciseId: 10, sets: [] }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Упражнение не найдено' });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });

  it('несуществующее упражнение → 404', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout() as never);
    exRepo.findExerciseById.mockResolvedValue(null);
    await expect(
      workoutService.saveWorkoutResults(USER, 7, {
        revision: 0,
        results: [{ order: 1, exerciseId: 999, sets: [] }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('programExerciseId из чужой программы → 404', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ programId: 50 }) as never);
    progRepo.findProgramExerciseById.mockResolvedValue(makePe(makeExercise(), { programId: 60 }) as never);
    await expect(
      workoutService.saveWorkoutResults(USER, 7, {
        revision: 0,
        results: [{ order: 1, programExerciseId: 500, sets: [] }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Упражнение программы не найдено' });
    expect(repo.runTransaction).not.toHaveBeenCalled();
  });
});

describe('saveWorkoutResults — CAS по revision', () => {
  function prepareFreeWorkout(): void {
    mockTransaction();
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ revision: 2 }) as never);
    exRepo.findExerciseById.mockResolvedValue(makeExercise() as never);
  }

  it('устаревшая revision → 409 с актуальной после отката; delete/create не вызываются', async () => {
    prepareFreeWorkout();
    repo.casUpdateWorkout.mockResolvedValue({ count: 0 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 5,
    } as never);

    await expect(
      workoutService.saveWorkoutResults(USER, 7, { revision: 2, results: [] }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('актуальная: 5'),
    });

    // Актуальная revision читается ТОЛЬКО после неудачного CAS
    expect(repo.findWorkoutRevision).toHaveBeenCalledWith(7);
    expect(repo.casUpdateWorkout.mock.invocationCallOrder[0]).toBeLessThan(
      repo.findWorkoutRevision.mock.invocationCallOrder[0],
    );
    expect(repo.deleteWorkoutResults).not.toHaveBeenCalled();
    expect(repo.createWorkoutResult).not.toHaveBeenCalled();
    expect(repo.createWorkoutSets).not.toHaveBeenCalled();
  });

  it('тренировка завершена параллельно → 409 «уже завершена»', async () => {
    prepareFreeWorkout();
    repo.casUpdateWorkout.mockResolvedValue({ count: 0 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 6,
    } as never);

    await expect(
      workoutService.saveWorkoutResults(USER, 7, { revision: 2, results: [] }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'Тренировка уже завершена' });
  });

  it('тренировка отменена параллельно → 409 «была отменена»', async () => {
    prepareFreeWorkout();
    repo.casUpdateWorkout.mockResolvedValue({ count: 0 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'cancelled',
      revision: 7,
    } as never);

    await expect(
      workoutService.saveWorkoutResults(USER, 7, { revision: 2, results: [] }),
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'Тренировка была отменена' });
  });

  it('ошибка вставки подходов пробрасывается без маскировки в 409', async () => {
    prepareFreeWorkout();
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);
    repo.createWorkoutResult.mockResolvedValue({ id: 101 } as never);
    const dbError = new Error('SQLITE_IOERR');
    repo.createWorkoutSets.mockRejectedValue(dbError);

    await expect(
      workoutService.saveWorkoutResults(USER, 7, {
        revision: 2,
        results: [{ order: 1, exerciseId: 10, sets: [{ order: 1, reps: 5 }] }],
      }),
    ).rejects.toBe(dbError);
    expect(repo.findWorkoutRevision).not.toHaveBeenCalled();
  });
});

describe('completeWorkout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('завершает активную: completedAt/durationSec считает сервер, CAS по revision', async () => {
    vi.useFakeTimers();
    const completedAt = new Date('2026-11-12T19:00:30.000Z');
    vi.setSystemTime(completedAt);

    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ revision: 3, startedAt: now }) as never)
      .mockResolvedValueOnce(
        makeWorkout({
          revision: 4,
          status: 'completed',
          completedAt,
          durationSec: 3630,
        }) as never,
      );
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);

    const dto = await workoutService.completeWorkout(USER, 7, { revision: 3 });

    expect(repo.casUpdateWorkout).toHaveBeenCalledWith(
      { id: 7, userId: USER, status: 'in_progress', revision: 3 },
      { status: 'completed', completedAt, durationSec: 3630 },
    );
    expect(dto).toMatchObject({
      status: 'completed',
      revision: 4,
      durationSec: 3630,
      completedAt: completedAt.toISOString(),
    });
  });

  it('несуществующая или чужая тренировка → 404 без CAS', async () => {
    repo.findWorkoutById.mockResolvedValueOnce(null);
    await expect(workoutService.completeWorkout(USER, 7, { revision: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    repo.findWorkoutById.mockResolvedValueOnce(makeWorkout({ userId: OTHER }) as never);
    await expect(workoutService.completeWorkout(USER, 7, { revision: 0 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repo.casUpdateWorkout).not.toHaveBeenCalled();
  });

  it('уже завершённую завершить нельзя → 409 без CAS', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'completed' }) as never);
    await expect(workoutService.completeWorkout(USER, 7, { revision: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Тренировка уже завершена',
    });
    expect(repo.casUpdateWorkout).not.toHaveBeenCalled();
  });

  it('отменённую завершить нельзя → 409 без CAS', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'cancelled' }) as never);
    await expect(workoutService.completeWorkout(USER, 7, { revision: 1 })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Тренировка была отменена',
    });
    expect(repo.casUpdateWorkout).not.toHaveBeenCalled();
  });

  it('устаревшая revision → 409 с актуальной после неудачного CAS', async () => {
    repo.findWorkoutById.mockResolvedValueOnce(makeWorkout({ revision: 3 }) as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 0 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 8,
    } as never);

    await expect(workoutService.completeWorkout(USER, 7, { revision: 3 })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringContaining('актуальная: 8'),
    });
    expect(repo.casUpdateWorkout.mock.invocationCallOrder[0]).toBeLessThan(
      repo.findWorkoutRevision.mock.invocationCallOrder[0],
    );
  });

  it('тренировка завершена параллельно → 409 «уже завершена»', async () => {
    repo.findWorkoutById.mockResolvedValueOnce(makeWorkout({ revision: 3 }) as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 0 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 4,
    } as never);

    await expect(workoutService.completeWorkout(USER, 7, { revision: 3 })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Тренировка уже завершена',
    });
  });
});

describe('cancelWorkout', () => {
  it('отменяет активную тренировку через CAS', async () => {
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ revision: 2 }) as never)
      .mockResolvedValueOnce(makeWorkout({ revision: 3, status: 'cancelled' }) as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 1 } as never);

    const dto = await workoutService.cancelWorkout(USER, 7);

    expect(repo.casUpdateWorkout).toHaveBeenCalledWith(
      { id: 7, userId: USER, status: 'in_progress', revision: 2 },
      { status: 'cancelled' },
    );
    expect(dto.status).toBe('cancelled');
    expect(dto.revision).toBe(3);
  });

  it('повторная отмена идемпотентна: CAS не вызывается', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'cancelled', revision: 5 }) as never);

    const dto = await workoutService.cancelWorkout(USER, 7);

    expect(dto.status).toBe('cancelled');
    expect(repo.casUpdateWorkout).not.toHaveBeenCalled();
  });

  it('завершённую отменить нельзя → 409 без CAS', async () => {
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'completed' }) as never);
    await expect(workoutService.cancelWorkout(USER, 7)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Завершённую тренировку нельзя отменить',
    });
    expect(repo.casUpdateWorkout).not.toHaveBeenCalled();
  });

  it('несуществующая или чужая тренировка → 404', async () => {
    repo.findWorkoutById.mockResolvedValueOnce(null);
    await expect(workoutService.cancelWorkout(USER, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    repo.findWorkoutById.mockResolvedValueOnce(makeWorkout({ userId: OTHER }) as never);
    await expect(workoutService.cancelWorkout(USER, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('параллельная отмена → идемпотентный ответ после CAS count=0', async () => {
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ revision: 2 }) as never)
      .mockResolvedValueOnce(makeWorkout({ revision: 5, status: 'cancelled' }) as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 0 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'cancelled',
      revision: 5,
    } as never);

    const dto = await workoutService.cancelWorkout(USER, 7);

    expect(repo.casUpdateWorkout).toHaveBeenCalledTimes(1);
    expect(dto.status).toBe('cancelled');
  });

  it('конкурентное автосохранение изменило revision → повторный CAS с актуальной', async () => {
    repo.findWorkoutById
      .mockResolvedValueOnce(makeWorkout({ revision: 2 }) as never)
      .mockResolvedValueOnce(makeWorkout({ revision: 6, status: 'cancelled' }) as never);
    repo.casUpdateWorkout
      .mockResolvedValueOnce({ count: 0 } as never)
      .mockResolvedValueOnce({ count: 1 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 5,
    } as never);

    const dto = await workoutService.cancelWorkout(USER, 7);

    expect(repo.casUpdateWorkout).toHaveBeenNthCalledWith(
      1,
      { id: 7, userId: USER, status: 'in_progress', revision: 2 },
      { status: 'cancelled' },
    );
    expect(repo.casUpdateWorkout).toHaveBeenNthCalledWith(
      2,
      { id: 7, userId: USER, status: 'in_progress', revision: 5 },
      { status: 'cancelled' },
    );
    expect(dto.status).toBe('cancelled');
  });

  it('завершена параллельно → 409', async () => {
    repo.findWorkoutById.mockResolvedValueOnce(makeWorkout({ revision: 2 }) as never);
    repo.casUpdateWorkout.mockResolvedValue({ count: 0 } as never);
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 4,
    } as never);

    await expect(workoutService.cancelWorkout(USER, 7)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Завершённую тренировку нельзя отменить',
    });
  });
});

describe('getWorkout', () => {
  it('возвращает детали тренировки владельцу в любом статусе', async () => {
    const set = { id: 900, workoutResultId: 100, order: 1, reps: 12, weight: null, duration: null, skipped: false };
    repo.findWorkoutById.mockResolvedValue(
      makeWorkout({ status: 'completed', results: [makeResult({ sets: [set] })] }) as never,
    );

    const dto = await workoutService.getWorkout(USER, 7);

    expect(dto.id).toBe(7);
    expect(dto.status).toBe('completed');
    expect(dto.results[0].sets).toHaveLength(1);
  });

  it('чужая или несуществующая тренировка → 404', async () => {
    repo.findWorkoutById.mockResolvedValueOnce(makeWorkout({ userId: OTHER }) as never);
    await expect(workoutService.getWorkout(USER, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    repo.findWorkoutById.mockResolvedValueOnce(null);
    await expect(workoutService.getWorkout(USER, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('updateWorkoutNotes', () => {
  it('активная тренировка: обновляет заметки, revision не меняется', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 2,
    } as never);
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ revision: 2, notes: 'новые' }) as never);
    repo.updateWorkoutNotes.mockResolvedValue({} as never);

    const dto = await workoutService.updateWorkoutNotes(USER, 7, { notes: 'новые' });

    expect(repo.updateWorkoutNotes).toHaveBeenCalledWith(7, 'новые');
    expect(dto.notes).toBe('новые');
    expect(dto.revision).toBe(2);
  });

  it('завершённая тренировка: заметки менять можно, null очищает', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 3,
    } as never);
    repo.findWorkoutById.mockResolvedValue(makeWorkout({ status: 'completed', notes: null }) as never);
    repo.updateWorkoutNotes.mockResolvedValue({} as never);

    const dto = await workoutService.updateWorkoutNotes(USER, 7, { notes: null });

    expect(repo.updateWorkoutNotes).toHaveBeenCalledWith(7, null);
    expect(dto.notes).toBeNull();
  });

  it('чужая или несуществующая → 404 без обновления', async () => {
    repo.findWorkoutRevision.mockResolvedValueOnce({
      id: 7,
      userId: OTHER,
      status: 'completed',
      revision: 1,
    } as never);
    await expect(
      workoutService.updateWorkoutNotes(USER, 7, { notes: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    repo.findWorkoutRevision.mockResolvedValueOnce(null);
    await expect(
      workoutService.updateWorkoutNotes(USER, 7, { notes: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(repo.updateWorkoutNotes).not.toHaveBeenCalled();
  });

  it('запись удалена между проверкой и UPDATE (P2025) → 404', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 2,
    } as never);
    repo.updateWorkoutNotes.mockRejectedValue({
      code: 'P2025',
      meta: { modelName: 'Workout', cause: 'Record to update not found.' },
    });

    await expect(
      workoutService.updateWorkoutNotes(USER, 7, { notes: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Тренировка не найдена' });
    expect(repo.findWorkoutById).not.toHaveBeenCalled();
  });

  it('прочие ошибки репозитория пробрасываются без маскировки', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 2,
    } as never);
    const dbError = new Error('SQLITE_IOERR');
    repo.updateWorkoutNotes.mockRejectedValue(dbError);

    await expect(
      workoutService.updateWorkoutNotes(USER, 7, { notes: 'x' }),
    ).rejects.toBe(dbError);
  });
});

describe('listWorkoutHistory', () => {
  it('только completed: фильтры place/from/to, пагинация и агрегаты счётчиков', async () => {
    repo.listWorkouts.mockResolvedValue([[makeListItem()], 1] as never);

    const result = await workoutService.listWorkoutHistory(USER, {
      page: 2,
      limit: 10,
      place: 'home',
      from: '2026-11-01',
      to: '2026-11-30',
    });

    expect(repo.listWorkouts).toHaveBeenCalledWith(
      {
        userId: USER,
        status: 'completed',
        place: 'home',
        startedAt: {
          gte: new Date('2026-11-01T00:00:00.000Z'),
          lt: new Date('2026-12-01T00:00:00.000Z'),
        },
      },
      2,
      10,
    );
    expect(result.data[0]).toMatchObject({
      id: 7,
      programId: 50,
      programName: 'Моя программа',
      durationSec: 3600,
      exercisesCount: 2,
      totalSets: 5,
    });
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 1 });
  });

  it('без фильтров: where содержит только userId и status', async () => {
    repo.listWorkouts.mockResolvedValue([[], 0] as never);

    const result = await workoutService.listWorkoutHistory(USER, { page: 1, limit: 20 });

    expect(repo.listWorkouts).toHaveBeenCalledWith({ userId: USER, status: 'completed' }, 1, 20);
    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 0 });
  });
});

describe('deleteWorkout', () => {
  it('удаляет завершённую тренировку', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 3,
    } as never);
    repo.deleteWorkout.mockResolvedValue({} as never);

    await expect(workoutService.deleteWorkout(USER, 7)).resolves.toBeUndefined();
    expect(repo.deleteWorkout).toHaveBeenCalledWith(7);
  });

  it('удаляет отменённую тренировку', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'cancelled',
      revision: 4,
    } as never);
    repo.deleteWorkout.mockResolvedValue({} as never);

    await workoutService.deleteWorkout(USER, 7);
    expect(repo.deleteWorkout).toHaveBeenCalledWith(7);
  });

  it('активную тренировку удалить нельзя → 409 без удаления', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'in_progress',
      revision: 2,
    } as never);

    await expect(workoutService.deleteWorkout(USER, 7)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Нельзя удалить активную тренировку',
    });
    expect(repo.deleteWorkout).not.toHaveBeenCalled();
  });

  it('чужая или несуществующая → 404 без удаления', async () => {
    repo.findWorkoutRevision.mockResolvedValueOnce({
      id: 7,
      userId: OTHER,
      status: 'completed',
      revision: 1,
    } as never);
    await expect(workoutService.deleteWorkout(USER, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    repo.findWorkoutRevision.mockResolvedValueOnce(null);
    await expect(workoutService.deleteWorkout(USER, 7)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(repo.deleteWorkout).not.toHaveBeenCalled();
  });

  it('запись удалена между проверкой и DELETE (P2025) → 404', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 3,
    } as never);
    repo.deleteWorkout.mockRejectedValue({
      code: 'P2025',
      meta: { modelName: 'Workout', cause: 'Record to delete does not exist.' },
    });

    await expect(workoutService.deleteWorkout(USER, 7)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Тренировка не найдена',
    });
  });

  it('прочие ошибки репозитория пробрасываются без маскировки', async () => {
    repo.findWorkoutRevision.mockResolvedValue({
      id: 7,
      userId: USER,
      status: 'completed',
      revision: 3,
    } as never);
    const dbError = new Error('SQLITE_IOERR');
    repo.deleteWorkout.mockRejectedValue(dbError);

    await expect(workoutService.deleteWorkout(USER, 7)).rejects.toBe(dbError);
  });
});
