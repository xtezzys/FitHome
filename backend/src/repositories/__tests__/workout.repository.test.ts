import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

// Prisma-клиент мокается: репозиторий проверяем на форму запросов (where/include/
// orderBy/tx-маршрутизация), поведенческие инварианты БД доказаны проверками 4.1.
vi.mock('../prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    workout: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    workoutResult: { create: vi.fn(), deleteMany: vi.fn() },
    workoutSet: { createMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { prisma } from '../prisma.js';
import * as workoutRepo from '../workout.repository.js';

const mocked = vi.mocked(prisma, true);

/** Заглушка TransactionClient — репозиторий обязан работать через переданный tx. */
function makeTx(): Prisma.TransactionClient {
  return {
    workout: {
      create: vi.fn().mockResolvedValue({ id: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workoutResult: {
      create: vi.fn().mockResolvedValue({ id: 10 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    workoutSet: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as Prisma.TransactionClient;
}

beforeEach(() => {
  // resetAllMocks: снимает и mockResolvedValue прошлых тестов — моки не «протекают»
  vi.resetAllMocks();
});

describe('createWorkout', () => {
  it('создаёт тренировку через prisma без tx', async () => {
    mocked.workout.create.mockResolvedValue({ id: 1 } as never);
    const data = { userId: 2, programId: null, programName: null, place: 'home' };
    await workoutRepo.createWorkout(data);
    expect(mocked.workout.create).toHaveBeenCalledTimes(1);
    expect(mocked.workout.create).toHaveBeenCalledWith({ data });
  });

  it('программная тренировка: передаёт programId и programName', async () => {
    mocked.workout.create.mockResolvedValue({ id: 1 } as never);
    await workoutRepo.createWorkout({ userId: 2, programId: 5, programName: 'Готовая', place: 'gym' });
    expect(mocked.workout.create).toHaveBeenCalledWith({
      data: { userId: 2, programId: 5, programName: 'Готовая', place: 'gym' },
    });
  });

  it('использует переданный TransactionClient, а не prisma', async () => {
    const tx = makeTx();
    await workoutRepo.createWorkout({ userId: 2, place: 'home' }, tx);
    expect(tx.workout.create).toHaveBeenCalledTimes(1);
    expect(mocked.workout.create).not.toHaveBeenCalled();
  });
});

describe('casUpdateWorkout', () => {
  it('updateMany с условием id + userId + status + revision и инкрементом revision', async () => {
    mocked.workout.updateMany.mockResolvedValue({ count: 1 });
    const completedAt = new Date('2026-11-12T18:00:00.000Z');
    const result = await workoutRepo.casUpdateWorkout(
      { id: 7, userId: 2, status: 'in_progress', revision: 3 },
      { status: 'completed', completedAt, durationSec: 3600 },
    );
    expect(result).toEqual({ count: 1 });
    expect(mocked.workout.updateMany).toHaveBeenCalledWith({
      where: { id: 7, userId: 2, status: 'in_progress', revision: 3 },
      data: { status: 'completed', completedAt, durationSec: 3600, revision: { increment: 1 } },
    });
  });

  it('выполняется в переданном tx (атомарность с заменой результатов)', async () => {
    const tx = makeTx();
    await workoutRepo.casUpdateWorkout(
      { id: 7, userId: 2, status: 'in_progress', revision: 0 },
      { status: 'cancelled' },
      tx,
    );
    expect(tx.workout.updateMany).toHaveBeenCalledWith({
      where: { id: 7, userId: 2, status: 'in_progress', revision: 0 },
      data: { status: 'cancelled', revision: { increment: 1 } },
    });
    expect(mocked.workout.updateMany).not.toHaveBeenCalled();
  });
});

describe('deleteWorkoutResults', () => {
  it('удаляет сначала sets, затем results (детерминированный порядок)', async () => {
    mocked.workoutSet.deleteMany.mockResolvedValue({ count: 2 });
    mocked.workoutResult.deleteMany.mockResolvedValue({ count: 1 });
    await workoutRepo.deleteWorkoutResults(7);
    expect(mocked.workoutSet.deleteMany).toHaveBeenCalledWith({ where: { workoutResult: { is: { workoutId: 7 } } } });
    expect(mocked.workoutResult.deleteMany).toHaveBeenCalledWith({ where: { workoutId: 7 } });
    expect(mocked.workoutSet.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.workoutResult.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it('оба удаления — в переданном tx (атомарность замены)', async () => {
    const tx = makeTx();
    await workoutRepo.deleteWorkoutResults(7, tx);
    expect(tx.workoutSet.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.workoutResult.deleteMany).toHaveBeenCalledTimes(1);
    expect(mocked.workoutSet.deleteMany).not.toHaveBeenCalled();
    expect(mocked.workoutResult.deleteMany).not.toHaveBeenCalled();
  });
});

describe('createWorkoutResult / createWorkoutSets', () => {
  it('создаёт результат в tx и возвращает строку с id', async () => {
    const tx = makeTx();
    const row = await workoutRepo.createWorkoutResult(
      { workoutId: 7, exerciseId: 3, programExerciseId: null, exerciseName: 'Отжимания', exerciseMetric: 'reps', order: 1 },
      tx,
    );
    expect(tx.workoutResult.create).toHaveBeenCalledWith({
      data: { workoutId: 7, exerciseId: 3, programExerciseId: null, exerciseName: 'Отжимания', exerciseMetric: 'reps', order: 1 },
    });
    expect(row).toEqual({ id: 10 });
    expect(mocked.workoutResult.create).not.toHaveBeenCalled();
  });

  it('createWorkoutSets маппит подходы с workoutResultId', async () => {
    const tx = makeTx();
    await workoutRepo.createWorkoutSets(
      10,
      [
        { order: 1, reps: 12, weight: 40.5 },
        { order: 2, skipped: true },
      ],
      tx,
    );
    expect(tx.workoutSet.createMany).toHaveBeenCalledWith({
      data: [
        { workoutResultId: 10, order: 1, reps: 12, weight: 40.5, duration: null, skipped: false },
        { workoutResultId: 10, order: 2, reps: null, weight: null, duration: null, skipped: true },
      ],
    });
  });

  it('пустой список подходов — createMany не вызывается', async () => {
    const tx = makeTx();
    const result = await workoutRepo.createWorkoutSets(10, [], tx);
    expect(result).toEqual({ count: 0 });
    expect(tx.workoutSet.createMany).not.toHaveBeenCalled();
  });
});

describe('findActiveByUser', () => {
  it('findFirst по userId и status=in_progress с результатами и подходами', async () => {
    mocked.workout.findFirst.mockResolvedValue(null);
    await workoutRepo.findActiveByUser(2);
    expect(mocked.workout.findFirst).toHaveBeenCalledWith({
      where: { userId: 2, status: 'in_progress' },
      include: {
        results: { orderBy: { order: 'asc' }, include: { sets: { orderBy: { order: 'asc' } } } },
      },
    });
  });
});

describe('findWorkoutById / findWorkoutRevision', () => {
  it('findWorkoutById — findUnique с результатами и подходами', async () => {
    mocked.workout.findUnique.mockResolvedValue(null);
    await workoutRepo.findWorkoutById(7);
    expect(mocked.workout.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      include: { results: { orderBy: { order: 'asc' }, include: { sets: { orderBy: { order: 'asc' } } } } },
    });
  });

  it('findWorkoutRevision — select только id/userId/status/revision', async () => {
    mocked.workout.findUnique.mockResolvedValue({ id: 7, userId: 2, status: 'in_progress', revision: 3 } as never);
    const row = await workoutRepo.findWorkoutRevision(7);
    expect(mocked.workout.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      select: { id: true, userId: true, status: true, revision: true },
    });
    expect(row).toEqual({ id: 7, userId: 2, status: 'in_progress', revision: 3 });
  });
});

describe('listWorkouts', () => {
  // batch-форма prisma.$transaction получает массив уже вызванных промисов —
  // мок разворачивает его через Promise.all, чтобы зафиксировать аргументы делегатов
  function mockBatchTransaction(): void {
    mocked.$transaction.mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg as Promise<unknown>[]);
      }
      throw new Error('listWorkouts должен использовать batch-форму $transaction');
    });
  }

  it('пагинация через $transaction([findMany, count]), orderBy startedAt desc', async () => {
    mockBatchTransaction();
    mocked.workout.findMany.mockResolvedValue([]);
    mocked.workout.count.mockResolvedValue(0);
    const where = { userId: 2, status: 'completed' };
    const [rows, total] = await workoutRepo.listWorkouts(where, 2, 20);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(mocked.$transaction).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(mocked.$transaction).mock.calls[0][0] as unknown as unknown[];
    expect(Array.isArray(batch)).toBe(true);
    expect(batch.length).toBe(2);
    expect(mocked.workout.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 20,
      }),
    );
    expect(mocked.workout.count).toHaveBeenCalledWith({ where });
  });

  it('история загружает счётчики, а не подходы (без N+1): include _count + results с _count.sets', async () => {
    mockBatchTransaction();
    mocked.workout.findMany.mockResolvedValue([]);
    mocked.workout.count.mockResolvedValue(0);
    await workoutRepo.listWorkouts({ userId: 2, status: 'completed' }, 1, 20);
    const arg = vi.mocked(mocked.workout.findMany).mock.calls[0][0] as {
      include: Record<string, unknown>;
    };
    // exercisesCount: фильтрованный каунт результатов (skipped исключены)
    expect(arg.include).toHaveProperty('_count.select.results.where', { skipped: false });
    // totalSets: результаты с фильтрованным каунтом подходов — sets не загружаются
    const resultsInclude = arg.include.results as Record<string, unknown>;
    expect(resultsInclude.where).toEqual({ skipped: false });
    expect(resultsInclude.select).toEqual({ _count: { select: { sets: { where: { skipped: false } } } } });
    expect(resultsInclude).not.toHaveProperty('include');
  });
});

describe('runTransaction / updateWorkoutNotes / deleteWorkout', () => {
  it('runTransaction пробрасывает fn и options в prisma.$transaction', async () => {
    mocked.$transaction.mockResolvedValue('ok');
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await workoutRepo.runTransaction(fn, { timeout: 15000 });
    expect(result).toBe('ok');
    expect(mocked.$transaction).toHaveBeenCalledWith(fn, { timeout: 15000 });
  });

  it('runTransaction без options — второй аргумент не передаётся', async () => {
    const fn = vi.fn().mockResolvedValue(1);
    await workoutRepo.runTransaction(fn);
    expect(mocked.$transaction).toHaveBeenCalledWith(fn, undefined);
  });

  it('updateWorkoutNotes обновляет только notes', async () => {
    mocked.workout.update.mockResolvedValue({} as never);
    await workoutRepo.updateWorkoutNotes(7, 'Заметка');
    expect(mocked.workout.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { notes: 'Заметка' } });
  });

  it('deleteWorkout удаляет по id (каскад FK проверен на уровне БД в 4.1)', async () => {
    mocked.workout.delete.mockResolvedValue({} as never);
    await workoutRepo.deleteWorkout(7);
    expect(mocked.workout.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});
