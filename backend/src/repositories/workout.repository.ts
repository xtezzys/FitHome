import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Доступ к данным тренировок через Prisma (docs/architecture.md §3).
 * Не содержит бизнес-правил — только запросы. Правила владения, статусы,
 * CAS по revision и маппинг P2002 в конфликт — в workout.service.
 *
 * Ключевые решения (этап 4 v3, §4 п.2/п.5):
 * - CAS выполняется через workout.updateMany с условием id + userId + status
 *   + revision и инкрементом revision — контракт «count» вместо исключения;
 * - CAS, удаление старых результатов и создание новых результатов/подходов
 *   принимают ОДИН TransactionClient — атомарны в одной транзакции;
 * - для истории счётчики (exercisesCount, totalSets) считаются агрегированно
 *   фильтрованными relation-каунтами — без загрузки подходов и без N+1.
 */

type TransactionClient = Prisma.TransactionClient;
type Client = TransactionClient | typeof prisma;

/** Транзакция для операций, затрагивающих несколько записей (CAS + замена результатов). */
export function runTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  return prisma.$transaction(fn, options);
}

function client(tx?: TransactionClient): Client {
  return tx ?? prisma;
}

export interface CreateWorkoutData {
  userId: number;
  programId?: number | null;
  programName?: string | null;
  place: string;
}

export interface CreateWorkoutResultData {
  workoutId: number;
  exerciseId: number | null;
  programExerciseId?: number | null;
  /** Снапшоты подставляет сервис из БД — клиентские значения не проходят через репозиторий. */
  exerciseName: string;
  exerciseMetric: string;
  order: number;
  skipped?: boolean;
  notes?: string | null;
}

export interface CreateWorkoutSetData {
  order: number;
  reps?: number | null;
  weight?: number | null;
  duration?: number | null;
  skipped?: boolean;
}

export interface CasWorkoutWhere {
  id: number;
  userId: number;
  status: string;
  revision: number;
}

const setsInclude = { orderBy: { order: 'asc' as const } };
const resultsInclude = { orderBy: { order: 'asc' as const }, include: { sets: setsInclude } };

export type WorkoutSetRow = Prisma.WorkoutSetGetPayload<object>;
export type WorkoutResultRow = Prisma.WorkoutResultGetPayload<{ include: { sets: typeof setsInclude } }>;
export type WorkoutDetailRow = Prisma.WorkoutGetPayload<{ include: { results: typeof resultsInclude } }>;

/**
 * Строка истории: упражнения и подходы НЕ загружаются —
 * exercisesCount (не пропущенные результаты) и totalSets (не пропущенные
 * подходы) считаются фильтрованными relation-каунтами в одном запросе.
 */
export type WorkoutListRow = Prisma.WorkoutGetPayload<{
  include: {
    _count: { select: { results: { where: { skipped: false } } } };
    results: {
      where: { skipped: false };
      select: { _count: { select: { sets: { where: { skipped: false } } } } };
    };
  };
}>;

// ─── Создание и чтение ───

export function createWorkout(data: CreateWorkoutData, tx?: TransactionClient) {
  return client(tx).workout.create({
    data: {
      userId: data.userId,
      programId: data.programId ?? null,
      programName: data.programName ?? null,
      place: data.place,
    },
  });
}

const detailInclude = { results: resultsInclude };

export function findWorkoutById(id: number) {
  return prisma.workout.findUnique({ where: { id }, include: detailInclude });
}

/** Активная (in_progress) тренировка пользователя со всеми результатами и подходами. */
export function findActiveByUser(userId: number) {
  return prisma.workout.findFirst({ where: { userId, status: 'in_progress' }, include: detailInclude });
}

/**
 * Текущие revision/status/id — сервис читает их ТОЛЬКО после отката
 * транзакции с несостоявшимся CAS (currentRevision для 409-stale).
 */
export function findWorkoutRevision(id: number) {
  return prisma.workout.findUnique({ where: { id }, select: { id: true, userId: true, status: true, revision: true } });
}

// ─── CAS по revision ───

/**
 * Условное обновление (compare-and-swap): обновляет запись только при совпадении
 * id, userId, status и ожидаемого revision; revision инкрементируется атомарно.
 * Возвращает { count }: count === 0 — запись не обновлена (stale/чужая/статус
 * изменился) — сервис обязан прервать транзакцию.
 */
export function casUpdateWorkout(
  where: CasWorkoutWhere,
  data: Prisma.WorkoutUpdateInput,
  tx?: TransactionClient,
): Promise<Prisma.BatchPayload> {
  return client(tx).workout.updateMany({
    where: { id: where.id, userId: where.userId, status: where.status, revision: where.revision },
    data: { ...data, revision: { increment: 1 } },
  });
}

// ─── Полная замена результатов и подходов (внутри транзакции сервиса) ───

/**
 * Удаление всех результатов и подходов тренировки. Порядок: сначала sets,
 * затем results — детерминированно, без опоры на FK-каскад соединения.
 */
export async function deleteWorkoutResults(workoutId: number, tx?: TransactionClient): Promise<void> {
  const c = client(tx);
  await c.workoutSet.deleteMany({ where: { workoutResult: { is: { workoutId } } } });
  await c.workoutResult.deleteMany({ where: { workoutId } });
}

export function createWorkoutResult(data: CreateWorkoutResultData, tx?: TransactionClient) {
  return client(tx).workoutResult.create({ data });
}

/** Подходы одного результата пачкой; пустой массив — no-op. */
export function createWorkoutSets(resultId: number, sets: CreateWorkoutSetData[], tx?: TransactionClient) {
  if (sets.length === 0) {
    return Promise.resolve({ count: 0 });
  }
  return client(tx).workoutSet.createMany({
    data: sets.map((s) => ({
      workoutResultId: resultId,
      order: s.order,
      reps: s.reps ?? null,
      weight: s.weight ?? null,
      duration: s.duration ?? null,
      skipped: s.skipped ?? false,
    })),
  });
}

// ─── Заметки, история, удаление ───

export function updateWorkoutNotes(id: number, notes: string | null) {
  return prisma.workout.update({ where: { id }, data: { notes } });
}

/**
 * История (where строит сервис: status='completed' + фильтры) с пагинацией:
 * [строки, всего]. Счётчики упражнений/подходов — фильтрованными каунтами
 * (skipped исключены) в том же запросе; подходы не загружаются.
 */
export async function listWorkouts(
  where: Prisma.WorkoutWhereInput,
  page: number,
  limit: number,
): Promise<[WorkoutListRow[], number]> {
  const [rows, total] = await prisma.$transaction([
    prisma.workout.findMany({
      where,
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        _count: { select: { results: { where: { skipped: false } } } },
        results: {
          where: { skipped: false },
          select: { _count: { select: { sets: { where: { skipped: false } } } } },
        },
      },
    }),
    prisma.workout.count({ where }),
  ]);
  return [rows as WorkoutListRow[], total];
}

export function deleteWorkout(id: number) {
  return prisma.workout.delete({ where: { id } });
}
