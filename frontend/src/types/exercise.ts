/**
 * Типы упражнений — зеркалят DTO backend (docs/api.md §3).
 */

export type Place = 'home' | 'outdoor' | 'gym';
export type Metric = 'reps' | 'reps_weight' | 'time';
export type Difficulty = 'easy' | 'medium' | 'hard';

/** Упражнение в ответах API. muscleGroups/equipment — массивы канонических токенов. */
export interface Exercise {
  id: number;
  name: string;
  description: string | null;
  place: Place;
  metric: Metric;
  muscleGroups: string[];
  difficulty: Difficulty;
  equipment: string[];
  userId: number | null;
  createdAt: string;
}

/** Пагинированный ответ спискового эндпоинта (docs/api.md §1). */
export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}

/** Параметры списка упражнений (docs/api.md §3).
 *  scope: all = базовые + свои; shared = только базовые; mine = только свои. */
export interface ExerciseListParams {
  page?: number;
  limit?: number;
  scope?: 'all' | 'shared' | 'mine';
  place?: string;
  metric?: string;
  difficulty?: string;
  muscle?: string[];
  equipment?: string[];
  search?: string;
}

/** Входные данные создания/редактирования упражнения. */
export interface ExerciseInput {
  name: string;
  description?: string;
  place: string;
  metric: string;
  muscleGroups: string[];
  difficulty: string;
  equipment?: string[];
}
