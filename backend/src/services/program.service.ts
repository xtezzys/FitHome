import type { Prisma } from '@prisma/client';
import type {
  AddProgramExerciseDto,
  CreateProgramDto,
  IncomingShareDetailDto,
  IncomingShareDto,
  OutgoingShareDto,
  PaginationMeta,
  ProgramDto,
  ProgramExerciseDto,
  ProgramListQuery,
  ProgramShareCreatedDto,
  PublicProgramListQuery,
  ReorderDto,
  ShareProgramDto,
  UpdateProgramDto,
  UpdateProgramExerciseDto,
} from '../types/dto.js';
import { AppError } from '../types/errors.js';
import { csvToArray } from '../lib/normalize.js';
import * as exerciseRepo from '../repositories/exercise.repository.js';
import * as programRepo from '../repositories/program.repository.js';
import * as userRepo from '../repositories/user.repository.js';

/**
 * Бизнес-логика программ (docs/api.md §4).
 * Права: готовые программы (userId = null) — общедоступны, но read-only;
 * свои программы — только владельцу. При копировании проверяется доступность
 * каждого упражнения; транзакция исключает частично созданную копию.
 */

type ProgramRow = Prisma.ProgramGetPayload<{
  include: { _count: { select: { exercises: true } }; user: { select: { name: true } } };
}>;
type ProgramDetailRow = Prisma.ProgramGetPayload<{
  include: {
    exercises: { include: { exercise: true } };
    user: { select: { name: true } };
  };
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
    restSec: row.restSec,
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
    isPublic: row.isPublic ?? false,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    authorName: row.user?.name ?? null,
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

/** GET /api/programs/:id — своя, готовая или опубликованная; чужая личная → 403. */
export async function getProgram(userId: number, id: number): Promise<ProgramDto> {
  const row = await programRepo.findProgramById(id);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Программа не найдена');
  }
  if (row.userId !== null && row.userId !== userId && !row.isPublic) {
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

/**
 * PUT /api/programs/:id — изменение своей программы; isPublic управляет
 * публикацией (publishedAt выставляет только сервер).
 */
export async function updateProgram(userId: number, id: number, dto: UpdateProgramDto): Promise<ProgramDto> {
  const row = await programRepo.findProgramById(id);
  const owned = requireOwnedProgram(row, userId);
  const data: programRepo.UpdateProgramData = { ...dto };
  if (dto.isPublic === true && owned.publishedAt === null) {
    data.publishedAt = new Date();
  }
  if (dto.isPublic === false) {
    data.publishedAt = null;
  }
  await programRepo.updateProgram(id, data);
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
 * Независимая копия программы в аккаунт пользователя: новая Program и новые
 * ProgramExercise. При skipInaccessible упражнения, недоступные получателю
 * (персональные автора), пропускаются — иначе сохранение чужой программы
 * было бы невозможно; иначе — 403 (поведение copyProgram).
 */
async function cloneProgram(
  userId: number,
  source: ProgramDetailRow,
  skipInaccessible = false,
): Promise<ProgramDto> {
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
    let order = 0;
    for (const pe of source.exercises) {
      if (pe.exercise.userId !== null && pe.exercise.userId !== userId) {
        if (skipInaccessible) {
          continue;
        }
        throw new AppError('FORBIDDEN', 'Программа содержит персональное упражнение другого пользователя');
      }
      order += 1;
      await programRepo.createProgramExercise(
        {
          programId: copy.id,
          exerciseId: pe.exerciseId,
          order,
          targetSets: pe.targetSets,
          targetReps: pe.targetReps,
          targetWeight: pe.targetWeight === null ? null : Number(pe.targetWeight),
          targetDuration: pe.targetDuration,
          restSec: pe.restSec,
        },
        tx,
      );
    }
    return copy.id;
  });

  const detail = await programRepo.findProgramById(newId);
  return programToDto(detail as ProgramDetailRow, true);
}

/** POST /api/programs/:id/copy — копия готовой, своей или опубликованной программы. */
export async function copyProgram(userId: number, id: number): Promise<ProgramDto> {
  const source = await programRepo.findProgramById(id);
  if (!source) {
    throw new AppError('NOT_FOUND', 'Программа не найдена');
  }
  if (source.userId !== null && source.userId !== userId && !source.isPublic) {
    throw new AppError('FORBIDDEN', 'Программа принадлежит другому пользователю');
  }
  return cloneProgram(userId, source);
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
    restSec: dto.restSec ?? 90,
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
    ...(dto.restSec !== undefined ? { restSec: dto.restSec } : {}),
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

// ─── Этап 5: публичная библиотека и отправка программ ───

/**
 * GET /api/programs/public — только добровольно опубликованные личные программы.
 * Поиск по названию выполняется в памяти (кириллица корректна без nameLower).
 */
export async function listPublicPrograms(
  query: PublicProgramListQuery,
): Promise<{ data: ProgramDto[]; meta: PaginationMeta }> {
  const rows = await programRepo.findPublicPrograms(query.place);
  const search = query.search?.toLowerCase();
  const filtered = search
    ? rows.filter((row) => row.name.toLowerCase().includes(search))
    : rows;
  const start = (query.page - 1) * query.limit;
  const pageRows = filtered.slice(start, start + query.limit);
  return {
    data: pageRows.map((row) => programToDto(row, false)),
    meta: { page: query.page, limit: query.limit, total: filtered.length },
  };
}

/**
 * POST /api/programs/:id/share — отправка своей программы по email.
 * Получатель получает независимую копию только после сохранения.
 */
export async function shareProgram(
  userId: number,
  programId: number,
  dto: ShareProgramDto,
): Promise<ProgramShareCreatedDto> {
  requireOwnedProgram(await programRepo.findProgramById(programId), userId);
  const recipient = await userRepo.findUserByEmail(dto.email);
  if (!recipient) {
    throw new AppError('NOT_FOUND', 'Пользователь с таким email не найден');
  }
  if (recipient.id === userId) {
    throw new AppError('VALIDATION_ERROR', 'Нельзя отправить программу самому себе');
  }
  if (await programRepo.findPendingShare(programId, recipient.id)) {
    throw new AppError('CONFLICT', 'Программа уже отправлена этому пользователю');
  }

  const share = await programRepo.createProgramShare({
    programId,
    fromUserId: userId,
    toUserId: recipient.id,
  });
  return {
    id: share.id,
    programId,
    toUserName: recipient.name,
    status: share.status,
    createdAt: share.createdAt.toISOString(),
  };
}

/** GET /api/programs/shares/incoming — полученные программы. */
export async function listIncomingShares(userId: number): Promise<IncomingShareDto[]> {
  const rows = await programRepo.listIncomingShares(userId);
  return rows.map((row) => ({
    id: row.id,
    programId: row.programId,
    programName: row.program.name,
    fromUserName: row.fromUser.name,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** GET /api/programs/shares/outgoing — отправленные программы. */
export async function listOutgoingShares(userId: number): Promise<OutgoingShareDto[]> {
  const rows = await programRepo.listOutgoingShares(userId);
  return rows.map((row) => ({
    id: row.id,
    programId: row.programId,
    programName: row.program.name,
    toUserName: row.toUser.name,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** GET /api/programs/shares/:shareId — просмотр полученной программы (только получатель). */
export async function getIncomingShare(
  userId: number,
  shareId: number,
): Promise<IncomingShareDetailDto> {
  const share = await programRepo.findProgramShareById(shareId);
  if (!share || share.toUserId !== userId) {
    throw new AppError('NOT_FOUND', 'Передача программы не найдена');
  }
  return {
    shareId: share.id,
    fromUserName: share.fromUser.name,
    status: share.status,
    program: programToDto(share.program as ProgramDetailRow, true),
  };
}

/**
 * POST /api/programs/shares/:shareId/save — независимая копия полученной
 * программы в библиотеку получателя; оригинал и его изменения не влияют.
 */
export async function saveSharedProgram(userId: number, shareId: number): Promise<ProgramDto> {
  const share = await programRepo.findProgramShareById(shareId);
  if (!share || share.toUserId !== userId) {
    throw new AppError('NOT_FOUND', 'Передача программы не найдена');
  }
  if (share.status === 'saved') {
    throw new AppError('CONFLICT', 'Программа уже сохранена в вашу библиотеку');
  }

  const copy = await cloneProgram(userId, share.program as ProgramDetailRow, true);
  await programRepo.updateProgramShareStatus(shareId, 'saved');
  return copy;
}

/** DELETE /api/programs/shares/:shareId — получатель убирает передачу из списка. */
export async function deleteIncomingShare(userId: number, shareId: number): Promise<void> {
  const share = await programRepo.findProgramShareById(shareId);
  if (!share || share.toUserId !== userId) {
    throw new AppError('NOT_FOUND', 'Передача программы не найдена');
  }
  await programRepo.deleteProgramShare(shareId);
}
