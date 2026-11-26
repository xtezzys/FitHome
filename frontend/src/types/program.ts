/**
 * Типы программ — зеркалят DTO backend (docs/api.md §4).
 */

import type { Exercise } from './exercise';

/** Упражнение в составе программы. targetWeight — число или null. */
export interface ProgramExercise {
  programExerciseId: number;
  order: number;
  targetSets: number;
  targetReps: number | null;
  targetWeight: number | null;
  targetDuration: number | null;
  /** Перерыв между подходами, сек (0 — без перерыва). */
  restSec: number;
  exercise: Exercise;
}

/** Программа: userId = null — готовая программа каталога. */
export interface Program {
  id: number;
  userId: number | null;
  name: string;
  description: string | null;
  place: 'home' | 'outdoor' | 'gym';
  isActive: boolean;
  isPublic: boolean;
  publishedAt: string | null;
  /** Имя автора — только для чужих публичных программ. */
  authorName: string | null;
  exercisesCount?: number;
  exercises?: ProgramExercise[];
  createdAt: string;
}

/** PUT /api/programs/:id — поля программы и публикация. */
export interface ProgramUpdateInput extends Partial<ProgramInput> {
  isPublic?: boolean;
}

/** Полученная программа (список входящих). */
export interface IncomingShare {
  id: number;
  programId: number;
  programName: string;
  fromUserName: string;
  status: string;
  createdAt: string;
}

/** Отправленная программа (список исходящих). */
export interface OutgoingShare {
  id: number;
  programId: number;
  programName: string;
  toUserName: string;
  status: string;
  createdAt: string;
}

/** Ответ на отправку программы. */
export interface ProgramShareCreated {
  id: number;
  programId: number;
  toUserName: string;
  status: string;
  createdAt: string;
}

/** Просмотр полученной программы. */
export interface IncomingShareDetail {
  shareId: number;
  fromUserName: string;
  status: string;
  program: Program;
}

/** Входные данные создания/редактирования программы. */
export interface ProgramInput {
  name: string;
  description?: string;
  place: string;
}

/** Входные данные добавления/изменения упражнения в программе. */
export interface ProgramExerciseInput {
  exerciseId?: number;
  targetSets?: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  targetDuration?: number | null;
  /** Перерыв между подходами, сек (0 — без перерыва). */
  restSec?: number;
}
