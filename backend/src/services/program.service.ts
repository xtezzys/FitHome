import type { Prisma } from '@prisma/client';
import type {
  AddProgramExerciseDto,
  CreateProgramDto,
  PaginationMeta,
  ProgramDto,
  ProgramExerciseDto,
  ProgramListQuery,
  ReorderDto,
  UpdateProgramDto,
  UpdateProgramExerciseDto,
} from '../types/dto.js';
import { AppError } from '../types/errors.js';
import { csvToArray } from '../lib/normalize.js';
import * as exerciseRepo from '../repositories/exercise.repository.js';
import * as programRepo from '../repositories/program.repository.js';

/**
 * Бизнес-логика программ (docs/api.md §4).
 * Права: готовые программы (userId = null) — общедоступны, но read-only;
 * свои программы — только владельцу. При копировании проверяется доступность
 * каждого упражнения; транзакция исключает частично созданную копию.
 */

type ProgramRow = Prisma.ProgramGetPayload<{ include: { _count: { select: { exercises: true } } } }>;
type ProgramDetailRow = Prisma.ProgramGetPayload<{
  include: { exercises: { include: { exercise: true } } };
}>;
type ProgramExerciseRow = Prisma.ProgramExerciseGetPayload<{ include: { exercise: true } }>;

function exerciseToDto(row: ProgramExerciseRow['exercise']) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    place: row.place,
    metric: row.metric,
    muscleGroups: csvToArray(row.muscleGroups),
    difficulty: row.difficulty,
    equipment: csvToArray(row.equipment),
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
  };
}

function programExerciseToDto(row: ProgramExerciseRow): ProgramExerciseDto {
  return {
    programExerciseId: row.id,
    order: row.order,
    targetSets: row.targetSets,
    targetReps: row.targetReps,
    targetWeight: row.targetWeight === null ? null : Number(row.targetWeight),
    targetDuration: row.targetDuration,
    exercise: exerciseToDto(row.exercise),
  };
}

function programToDto(
  row: ProgramRow | ProgramDetailRow,
  withExercises: boolean,
): ProgramDto {
  const detail = row as ProgramDetailRow;
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    place: row.place,
    isActive: row.isActive,
    ...(withExercises
      ? {
          exercises: (detail.exercises ?? []).map(programExerciseToDto),
        }
      : {
          exercisesCount: (row as ProgramRow)._count.exercises,
        }),
    createdAt: row.createdAt.toISOString(),
  };
}

/** GET /api/programs — свои (scope=mine) или готовые (scope=ready). */
export async function listPrograms(
  userId: number,
  query: ProgramListQuery,
): Promise<{ data: ProgramDto[]; meta: PaginationMeta }> {
  // scope=ready — готовые каталога; scope=mine — по умолчанию только активные
  // (soft delete скрывает программу из списка), ?isActive=false покажет удалённые
  const where: Prisma.ProgramWhereInput =
    query.scope === 'ready'
      ? { userId: null, isActive: true }
      : { userId, isActive: query.isActive ?? true };
  if (query.place) where.place = query.place;

  const [rows, total] = await programRepo.listPrograms(where, query.page, query.limit);
  return {
    data: rows.map((row) => programToDto(row, false)),
    meta: { page: query.page, limit: query.limit, total },
  };
}

/** GET /api/programs/:id — своя или готовая; чужая персональная → 403. */
export async function getProgram(userId: number, id: number): Promise<ProgramDto> {
  const row = await programRepo.findProgramById(id);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Программа не найдена');
  }
  if (row.userId !== null && row.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Программа принадлежит другому пользователю');
  }
  return programToDto(row, true);
}

function requireOwnedProgram(
  row: ProgramDetailRow | null,
  userId: number,
): ProgramDetailRow {
  if (!row) {
    throw new AppError('NOT_FOUND', 'Программа не найдена');
  }
  if (row.userId === null) {
    throw new AppError('FORBIDDEN', 'Готовые программы доступны только для чтения');
  }
  if (row.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Программа принадлежит другому пользователю');
  }
  return row;
}

/** POST /api/programs — создание своей программы. */
export async function createProgram(userId: number, dto: CreateProgramDto): Promise<ProgramDto> {
  const row = await programRepo.createProgram({
    userId,
    name: dto.name,
    description: dto.description,
    place: dto.place,
    isActive: true,
  });
  const detail = await programRepo.findProgramById(row.id);
  return programToDto(detail as ProgramDetailRow, true);
}

/** PUT /api/programs/:id — изменение своей программы. */
export async function updateProgram(userId: number, id: number, dto: UpdateProgramDto): Promise<ProgramDto> {
  const row = await programRepo.findProgramById(id);
  requireOwnedProgram(row, userId);
  await programRepo.updateProgram(id, dto);
  const detail = await programRepo.findProgramById(id);
  return programToDto(detail as ProgramDetailRow, true);
}

/** DELETE /api/programs/:id — soft delete своей программы (isActive = false). */
export async function deleteProgram(userId: number, id: number): Promise<void> {
  const row = await programRepo.findProgramById(id);
  requireOwnedProgram(row, userId);
  await programRepo.softDeleteProgram(id);
}

/**
 * POST /api/programs/:id/copy — клонирование готовой или своей программы
 * в аккаунт. Транзакция: при недоступности любого упражнения откат
 * исключает частично созданную копию (docs/api.md §4).
 */
export async function copyProgram(userId: number, id: number): Promise<ProgramDto> {
  const source = await programRepo.findProgramById(id);
  if (!source) {
    throw new AppError('NOT_FOUND', 'Программа не найдена');
  }
  if (source.userId !== null && source.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Программа принадлежит другому пользователю');
  }

  const newId = await programRepo.runTransaction(async (tx) => {
    const copy = await programRepo.createProgram(
      {
        userId,
        name: source.name,
        description: source.description ?? undefined,
        place: source.place,
        isActive: true,
      },
      tx,
    );
    for (const pe of source.exercises) {
      // Доступность упражнения: общее или персональное текущего пользователя
      if (pe.exercise.userId !== null && pe.exercise.userId !== userId) {
        throw new AppError('FORBIDDEN', 'Программа содержит персональное упражнение другого пользователя');
      }
      await programRepo.createProgramExercise(
        {
          programId: copy.id,
          exerciseId: pe.exerciseId,
          order: pe.order,
          targetSets: pe.targetSets,
          targetReps: pe.targetReps,
          targetWeight: pe.targetWeight === null ? null : Number(pe.targetWeight),
          targetDuration: pe.targetDuration,
        },
        tx,
      );
    }
    return copy.id;
  });

  const detail = await programRepo.findProgramById(newId);
  return programToDto(detail as ProgramDetailRow, true);
}

/**
 * Целевые значения должны соответствовать метрике упражнения
 * (docs/database.md §3): reps → targetReps; reps_weight → targetReps+targetWeight;
 * time → targetDuration. Остальные поля — null.
 */
function validateTargetsByMetric(
  metric: string,
  targets: { targetReps: number | null; targetWeight: number | null; targetDuration: number | null },
): void {
  const { targetReps, targetWeight, targetDuration } = targets;
  const invalid =
    (metric === 'reps' && (targetReps === null || targetWeight !== null || targetDuration !== null)) ||
    (metric === 'reps_weight' && (targetReps === null || targetWeight === null || targetDuration !== null)) ||
    (metric === 'time' && (targetDuration === null || targetReps !== null || targetWeight !== null));
  if (invalid) {
    throw new AppError(
      'VALIDATION_ERROR',
      metric === 'time'
        ? 'Для метрики "time" требуется targetDuration, targetReps/targetWeight не задаются'
        : metric === 'reps_weight'
          ? 'Для метрики "reps_weight" требуются targetReps и targetWeight, targetDuration не задаётся'
          : 'Для метрики "reps" требуется targetReps, targetWeight/targetDuration не задаются',
    );
  }
}

async function requireAccessibleExercise(userId: number, exerciseId: number) {
  const exercise = await exerciseRepo.findExerciseById(exerciseId);
  if (!exercise) {
    throw new AppError('NOT_FOUND', 'Упражнение не найдено');
  }
  if (exercise.userId !== null && exercise.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Персональное упражнение другого пользователя недоступно');
  }
  return exercise;
}

/** POST /api/programs/:id/exercises — добавление упражнения в свою программу. */
export async function addProgramExercise(
  userId: number,
  programId: number,
  dto: AddProgramExerciseDto,
): Promise<ProgramExerciseDto> {
  await requireOwnedProgram(await programRepo.findProgramById(programId), userId);

  const exercise = await requireAccessibleExercise(userId, dto.exerciseId);
  validateTargetsByMetric(exercise.metric, {
    targetReps: dto.targetReps ?? null,
    targetWeight: dto.targetWeight ?? null,
    targetDuration: dto.targetDuration ?? null,
  });

  // Явная позиция — должна быть свободна (docs/api.md §4); иначе — в конец
  const order = dto.order ?? (await programRepo.findMaxProgramExerciseOrder(programId)) + 1;
  const occupied = await programRepo.findProgramExerciseByOrder(programId, order);
  if (occupied) {
    throw new AppError('VALIDATION_ERROR', `Позиция order ${order} уже занята`);
  }

  const row = await programRepo.createProgramExercise({
    programId,
    exerciseId: dto.exerciseId,
    order,
    targetSets: dto.targetSets,
    targetReps: dto.targetReps ?? null,
    targetWeight: dto.targetWeight ?? null,
    targetDuration: dto.targetDuration ?? null,
  });
  return programExerciseToDto(row as ProgramExerciseRow);
}

/** PUT /api/programs/:id/exercises/:peId — изменение целей (и/или упражнения). */
export async function updateProgramExercise(
  userId: number,
  programId: number,
  peId: number,
  dto: UpdateProgramExerciseDto,
): Promise<ProgramExerciseDto> {
  await requireOwnedProgram(await programRepo.findProgramById(programId), userId);

  const row = await programRepo.findProgramExerciseById(peId);
  if (!row || row.programId !== programId) {
    throw new AppError('NOT_FOUND', 'Упражнение в программе не найдено');
  }

  // Смена упражнения — с проверкой доступности; метрика берётся целевого упражнения
  let targetExerciseId = row.exerciseId;
  if (dto.exerciseId !== undefined && dto.exerciseId !== row.exerciseId) {
    await requireAccessibleExercise(userId, dto.exerciseId);
    targetExerciseId = dto.exerciseId;
  }
  const targetExercise =
    dto.exerciseId !== undefined && dto.exerciseId !== row.exerciseId
      ? (await exerciseRepo.findExerciseById(dto.exerciseId))!
      : row.exercise;

  validateTargetsByMetric(targetExercise.metric, {
    targetReps: dto.targetReps ?? (dto.targetReps === undefined ? row.targetReps : null),
    targetWeight: dto.targetWeight ?? (dto.targetWeight === undefined ? (row.targetWeight === null ? null : Number(row.targetWeight)) : null),
    targetDuration: dto.targetDuration ?? (dto.targetDuration === undefined ? row.targetDuration : null),
  });

  const updated = await programRepo.updateProgramExercise(peId, {
    ...(dto.exerciseId !== undefined ? { exerciseId: targetExerciseId } : {}),
    ...(dto.targetSets !== undefined ? { targetSets: dto.targetSets } : {}),
    ...(dto.targetReps !== undefined ? { targetReps: dto.targetReps } : {}),
    ...(dto.targetWeight !== undefined ? { targetWeight: dto.targetWeight } : {}),
    ...(dto.targetDuration !== undefined ? { targetDuration: dto.targetDuration } : {}),
  });
  return programExerciseToDto(updated as ProgramExerciseRow);
}

/**
 * PUT /api/programs/:id/exercises/order — пакетная перестановка.
 * Набор ids должен покрывать состав программы ровно, orders — перестановка 1..n.
 * Двухфазное обновление в транзакции обходит unique (programId, order).
 */
export async function reorderProgramExercises(
  userId: number,
  programId: number,
  dto: ReorderDto,
): Promise<ProgramDto> {
  const owned = requireOwnedProgram(await programRepo.findProgramById(programId), userId);
  const rows = owned.exercises;
  const rowIds = new Set(rows.map((r) => r.id));
  const requestedIds = dto.orders.map((o) => o.programExerciseId);
  const requestedOrders = dto.orders.map((o) => o.order);

  const idsMatch = requestedIds.length === rows.length && requestedIds.every((id) => rowIds.has(id));
  const ordersUnique = new Set(requestedOrders).size === requestedOrders.length;
  const ordersInRange = requestedOrders.every((o) => o >= 1 && o <= rows.length);
  if (!idsMatch || !ordersUnique || !ordersInRange) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Поле "orders" должно содержать все упражнения программы ровно один раз с уникальными позициями от 1 до N',
    );
  }

  await programRepo.runTransaction(async (tx) => {
    // Фаза 1: отрицательные промежуточные значения — освобождаем позиции
    for (const row of rows) {
      await programRepo.updateProgramExerciseOrder(row.id, -row.order, tx);
    }
    // Фаза 2: финальные позиции
    for (const item of dto.orders) {
      await programRepo.updateProgramExerciseOrder(item.programExerciseId, item.order, tx);
    }
  });

  const detail = await programRepo.findProgramById(programId);
  return programToDto(detail as ProgramDetailRow, true);
}

/** DELETE /api/programs/:id/exercises/:peId — удаление + нормализация порядка. */
export async function removeProgramExercise(
  userId: number,
  programId: number,
  peId: number,
): Promise<void> {
  const program = await programRepo.findProgramById(programId);
  requireOwnedProgram(program, userId);

  const row = await programRepo.findProgramExerciseById(peId);
  if (!row || row.programId !== programId) {
    throw new AppError('NOT_FOUND', 'Упражнение в программе не найдено');
  }

  await programRepo.runTransaction(async (tx) => {
    await programRepo.deleteProgramExercise(peId, tx);
    // Нормализация порядка 1..n после удаления
    const remaining = await programRepo.listProgramExercises(programId);
    let expected = 1;
    for (const item of remaining) {
      if (item.order !== expected) {
        await programRepo.updateProgramExerciseOrder(item.id, expected, tx);
      }
      expected += 1;
    }
  });
}
