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
  exercisesCount?: number;
  exercises?: ProgramExercise[];
  createdAt: string;
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
}
