import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Доступ к данным программ и упражнений в программах через Prisma
 * (docs/architecture.md §3). Не содержит бизнес-правил.
 * Транзакции копирования/перестановки открываются service'ом через runTransaction.
 */

export interface CreateProgramData {
  userId: number | null;
  name: string;
  description?: string;
  place: string;
  isActive?: boolean;
}

export interface UpdateProgramData {
  name?: string;
  description?: string;
  place?: string;
  isActive?: boolean;
}

export interface CreateProgramExerciseData {
  programId: number;
  exerciseId: number;
  order: number;
  targetSets?: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  targetDuration?: number | null;
}

type TransactionClient = Prisma.TransactionClient;
type Client = TransactionClient | typeof prisma;

/** Транзакция для операций, затрагивающих несколько записей (copy/reorder/delete). */
export function runTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}

function client(tx?: TransactionClient): Client {
  return tx ?? prisma;
}

const programInclude = {
  exercises: {
    orderBy: { order: 'asc' as const },
    include: { exercise: true },
  },
};

export type ProgramRow = Prisma.ProgramGetPayload<{ include: { _count: { select: { exercises: true } } } }>;
export type ProgramWithExercises = Prisma.ProgramGetPayload<{
  include: { exercises: { orderBy: { order: 'asc' }; include: { exercise: true } } };
}>;

/** Список программ с пагинацией и количеством упражнений: [строки, всего]. */
export async function listPrograms(
  where: Prisma.ProgramWhereInput,
  page: number,
  limit: number,
): Promise<[ProgramRow[], number]> {
  const [rows, total] = await prisma.$transaction([
    prisma.program.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { _count: { select: { exercises: true } } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.program.count({ where }),
  ]);
  return [rows, total];
}

/** Программа с упорядоченным составом и упражнениями. */
export function findProgramById(id: number) {
  return prisma.program.findUnique({
    where: { id },
    include: programInclude,
  });
}

export function createProgram(data: CreateProgramData, tx?: TransactionClient) {
  return client(tx).program.create({ data });
}

export function updateProgram(id: number, data: UpdateProgramData, tx?: TransactionClient) {
  return client(tx).program.update({ where: { id }, data });
}

/** Soft delete: isActive = false (docs/database.md §2.4). */
export function softDeleteProgram(id: number) {
  return prisma.program.update({ where: { id }, data: { isActive: false } });
}

// ─── Упражнения в составе программы ───

export function findProgramExerciseById(id: number) {
  return prisma.programExercise.findUnique({ where: { id }, include: { exercise: true } });
}

export function findProgramExerciseByOrder(programId: number, order: number) {
  return prisma.programExercise.findFirst({ where: { programId, order } });
}

export function listProgramExercises(programId: number) {
  return prisma.programExercise.findMany({ where: { programId }, orderBy: { order: 'asc' } });
}

export function findMaxProgramExerciseOrder(programId: number): Promise<number> {
  return prisma.programExercise
    .aggregate({ where: { programId }, _max: { order: true } })
    .then((r) => r._max.order ?? 0);
}

export function createProgramExercise(data: CreateProgramExerciseData, tx?: TransactionClient) {
  return client(tx).programExercise.create({
    data,
    include: { exercise: true },
  });
}

export function updateProgramExercise(
  id: number,
  data: {
    exerciseId?: number;
    targetSets?: number;
    targetReps?: number | null;
    targetWeight?: number | null;
    targetDuration?: number | null;
  },
  tx?: TransactionClient,
) {
  return client(tx).programExercise.update({ where: { id }, data, include: { exercise: true } });
}

export function deleteProgramExercise(id: number, tx?: TransactionClient) {
  return client(tx).programExercise.delete({ where: { id } });
}

/** Изменение порядка одной строки; отрицательные значения — двухфазная перестановка. */
export function updateProgramExerciseOrder(id: number, order: number, tx?: TransactionClient) {
  return client(tx).programExercise.update({ where: { id }, data: { order } });
}
