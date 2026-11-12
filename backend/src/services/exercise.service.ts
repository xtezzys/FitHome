import type { Prisma } from '@prisma/client';
import type {
  CreateExerciseDto,
  ExerciseDto,
  ExerciseListQuery,
  PaginationMeta,
  UpdateExerciseDto,
} from '../types/dto.js';
import { AppError } from '../types/errors.js';
import { csvFromTokens, csvToArray, normalizeName } from '../lib/normalize.js';
import * as exerciseRepo from '../repositories/exercise.repository.js';

/**
 * Бизнес-логика каталога упражнений (docs/api.md §3).
 * Права: общие упражнения (userId = null) видны всем, изменять их нельзя;
 * персональные доступны только владельцу. Поиск — по nameLower (кириллица
 * корректна благодаря JS toLowerCase, docs/stage0-experiments.md).
 */

type ExerciseRow = Prisma.ExerciseGetPayload<object>;

function toDto(row: ExerciseRow): ExerciseDto {
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

/** GET /api/exercises — список с фильтрами, поиском и пагинацией. */
export async function listExercises(
  userId: number,
  query: ExerciseListQuery,
): Promise<{ data: ExerciseDto[]; meta: PaginationMeta }> {
  // Видимость по scope (docs/api.md §3): all = общие + свои, shared = только
  // базовые, mine = только свои. CSV-фильтры — any-match по списку токенов
  // (OR между contains одного поля выражается через верхнеуровневый OR внутри AND-группы).
  const visibility: Prisma.ExerciseWhereInput =
    query.scope === 'shared'
      ? { userId: null }
      : query.scope === 'mine'
        ? { userId }
        : { OR: [{ userId: null }, { userId }] };
  const and: Prisma.ExerciseWhereInput[] = [visibility];
  if (query.muscle?.length) {
    and.push({ OR: query.muscle.map((t) => ({ muscleGroups: { contains: `,${t},` } })) });
  }
  if (query.equipment?.length) {
    and.push({ OR: query.equipment.map((t) => ({ equipment: { contains: `,${t},` } })) });
  }
  const where: Prisma.ExerciseWhereInput = { AND: and };
  if (query.place) where.place = query.place;
  if (query.metric) where.metric = query.metric;
  if (query.difficulty) where.difficulty = query.difficulty;
  if (query.search) {
    where.nameLower = { contains: normalizeName(query.search) };
  }

  const [rows, total] = await exerciseRepo.listExercises(where, query.page, query.limit);
  return {
    data: rows.map(toDto),
    meta: { page: query.page, limit: query.limit, total },
  };
}

/** GET /api/exercises/:id — детали; чужое персональное → 403. */
export async function getExercise(userId: number, id: number): Promise<ExerciseDto> {
  const row = await exerciseRepo.findExerciseById(id);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Упражнение не найдено');
  }
  if (row.userId !== null && row.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Упражнение принадлежит другому пользователю');
  }
  return toDto(row);
}

/** POST /api/exercises — создание персонального упражнения. */
export async function createExercise(userId: number, dto: CreateExerciseDto): Promise<ExerciseDto> {
  const nameLower = normalizeName(dto.name);
  const duplicate = await exerciseRepo.findPersonalByNameLower(userId, nameLower);
  if (duplicate) {
    throw new AppError('CONFLICT', 'Упражнение с таким названием уже есть у пользователя');
  }
  const row = await exerciseRepo.createExercise({
    name: dto.name,
    nameLower,
    description: dto.description,
    place: dto.place,
    metric: dto.metric,
    muscleGroups: csvFromTokens(dto.muscleGroups),
    difficulty: dto.difficulty,
    equipment: dto.equipment && dto.equipment.length > 0 ? csvFromTokens(dto.equipment) : null,
    userId,
  });
  return toDto(row);
}

/** PUT /api/exercises/:id — изменение только своего персонального упражнения. */
export async function updateExercise(userId: number, id: number, dto: UpdateExerciseDto): Promise<ExerciseDto> {
  const row = await exerciseRepo.findExerciseById(id);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Упражнение не найдено');
  }
  if (row.userId === null) {
    throw new AppError('FORBIDDEN', 'Общие упражнения каталога изменять нельзя');
  }
  if (row.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Упражнение принадлежит другому пользователю');
  }

  const data: Parameters<typeof exerciseRepo.updateExercise>[1] = {};
  if (dto.name !== undefined) {
    const nameLower = normalizeName(dto.name);
    const duplicate = await exerciseRepo.findPersonalByNameLower(userId, nameLower, id);
    if (duplicate) {
      throw new AppError('CONFLICT', 'Упражнение с таким названием уже есть у пользователя');
    }
    data.name = dto.name;
    data.nameLower = nameLower;
  }
  if (dto.description !== undefined) data.description = dto.description;
  if (dto.place !== undefined) data.place = dto.place;
  if (dto.metric !== undefined) data.metric = dto.metric;
  if (dto.difficulty !== undefined) data.difficulty = dto.difficulty;
  if (dto.muscleGroups !== undefined) data.muscleGroups = csvFromTokens(dto.muscleGroups);
  if (dto.equipment !== undefined) {
    data.equipment = dto.equipment.length > 0 ? csvFromTokens(dto.equipment) : null;
  }
  return toDto(await exerciseRepo.updateExercise(id, data));
}

/** DELETE /api/exercises/:id — удаление своего упражнения; используемое → 409. */
export async function deleteExercise(userId: number, id: number): Promise<void> {
  const row = await exerciseRepo.findExerciseById(id);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Упражнение не найдено');
  }
  if (row.userId === null) {
    throw new AppError('FORBIDDEN', 'Общие упражнения каталога удалять нельзя');
  }
  if (row.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Упражнение принадлежит другому пользователю');
  }
  try {
    await exerciseRepo.deleteExercise(id);
  } catch (err) {
    if ((err as { code?: string }).code === 'P2003') {
      throw new AppError('CONFLICT', 'Упражнение используется в программах или результатах тренировок');
    }
    throw err;
  }
}
