import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Доступ к данным упражнений через Prisma (docs/architecture.md §3).
 * Не содержит бизнес-правил — только запросы. Правила видимости
 * (общие + персональные пользователя) формирует service в виде where.
 */

export interface CreateExerciseData {
  name: string;
  nameLower: string;
  description?: string;
  place: string;
  metric: string;
  muscleGroups: string;
  difficulty: string;
  equipment?: string | null;
  userId: number | null;
}

export interface UpdateExerciseData {
  name?: string;
  nameLower?: string;
  description?: string;
  place?: string;
  metric?: string;
  muscleGroups?: string;
  difficulty?: string;
  equipment?: string | null;
}

export type ExerciseRow = Prisma.ExerciseGetPayload<object>;

/** Список с пагинацией: [строки, всего]. orderBy детерминированный. */
export async function listExercises(
  where: Prisma.ExerciseWhereInput,
  page: number,
  limit: number,
): Promise<[ExerciseRow[], number]> {
  const [rows, total] = await prisma.$transaction([
    prisma.exercise.findMany({
      where,
      orderBy: [{ nameLower: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.exercise.count({ where }),
  ]);
  return [rows, total];
}

export function findExerciseById(id: number) {
  return prisma.exercise.findUnique({ where: { id } });
}

/** Персональное упражнение пользователя с таким именем (проверка уникальности). */
export function findPersonalByNameLower(userId: number, nameLower: string, excludeId?: number) {
  return prisma.exercise.findFirst({
    where: { userId, nameLower, ...(excludeId !== undefined ? { id: { not: excludeId } } : {}) },
  });
}

export function createExercise(data: CreateExerciseData) {
  return prisma.exercise.create({ data });
}

export function updateExercise(id: number, data: UpdateExerciseData) {
  return prisma.exercise.update({ where: { id }, data });
}

export function deleteExercise(id: number) {
  return prisma.exercise.delete({ where: { id } });
}
