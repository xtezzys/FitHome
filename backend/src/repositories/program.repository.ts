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
  isPublic?: boolean;
  publishedAt?: Date | null;
}

export interface CreateProgramExerciseData {
  programId: number;
  exerciseId: number;
  order: number;
  targetSets?: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  targetDuration?: number | null;
  restSec?: number;
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
  user: { select: { name: true } },
};

export type ProgramRow = Prisma.ProgramGetPayload<{
  include: { _count: { select: { exercises: true } }; user: { select: { name: true } } };
}>;
export type ProgramWithExercises = Prisma.ProgramGetPayload<{
  include: {
    exercises: { orderBy: { order: 'asc' }; include: { exercise: true } };
    user: { select: { name: true } };
  };
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
      include: { _count: { select: { exercises: true } }, user: { select: { name: true } } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.program.count({ where }),
  ]);
  return [rows, total];
}

/**
 * Публичная библиотека: только добровольно опубликованные личные программы.
 * Поиск по названию выполняется в сервисе (кириллица без nameLower).
 */
export function findPublicPrograms(place?: string) {
  return prisma.program.findMany({
    where: {
      isPublic: true,
      isActive: true,
      userId: { not: null },
      ...(place ? { place } : {}),
    },
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: 200,
    include: { _count: { select: { exercises: true } }, user: { select: { name: true } } },
  });
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
    restSec?: number;
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

// ─── Отправка программы пользователю (этап 5) ───

export interface CreateProgramShareData {
  programId: number;
  fromUserId: number;
  toUserId: number;
}

export function createProgramShare(data: CreateProgramShareData) {
  return prisma.programShare.create({ data });
}

export function findPendingShare(programId: number, toUserId: number) {
  return prisma.programShare.findFirst({
    where: { programId, toUserId, status: 'pending' },
  });
}

/** Детали передачи: программа с составом и автор — только для получателя (проверка в service). */
export function findProgramShareById(id: number) {
  return prisma.programShare.findUnique({
    where: { id },
    include: {
      program: { include: programInclude },
      fromUser: { select: { name: true } },
    },
  });
}

export function listIncomingShares(toUserId: number) {
  return prisma.programShare.findMany({
    where: { toUserId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      program: { select: { name: true } },
      fromUser: { select: { name: true } },
    },
  });
}

export function listOutgoingShares(fromUserId: number) {
  return prisma.programShare.findMany({
    where: { fromUserId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      program: { select: { name: true } },
      toUser: { select: { name: true } },
    },
  });
}

export function updateProgramShareStatus(id: number, status: string) {
  return prisma.programShare.update({ where: { id }, data: { status } });
}

export function deleteProgramShare(id: number) {
  return prisma.programShare.delete({ where: { id } });
}
