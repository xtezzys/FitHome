/**
 * DTO авторизации и профиля (docs/api.md §2).
 * Формируются валидаторами (middlewares/validate.ts) на границе контроллеров.
 */

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface UpdateProfileDto {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}

/** Публичное представление пользователя — без passwordHash. */
export interface UserDto {
  id: number;
  email: string;
  name: string;
  createdAt: string;
}

/** Результат регистрации/входа: пользователь + access-токен. */
export interface AuthSessionDto {
  user: UserDto;
  accessToken: string;
}

/** Метаданные пагинации списковых эндпоинтов (docs/api.md §1). */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

/** Упражнение в ответах API (docs/api.md §3). muscleGroups/equipment — массивы токенов. */
export interface ExerciseDto {
  id: number;
  name: string;
  description: string | null;
  place: string;
  metric: string;
  muscleGroups: string[];
  difficulty: string;
  equipment: string[];
  userId: number | null;
  createdAt: string;
}

/** Упражнение в составе программы (docs/api.md §4). targetWeight — число или null. */
export interface ProgramExerciseDto {
  programExerciseId: number;
  order: number;
  targetSets: number;
  targetReps: number | null;
  targetWeight: number | null;
  targetDuration: number | null;
  exercise: ExerciseDto;
}

/** Программа в ответах API (docs/api.md §4). */
export interface ProgramDto {
  id: number;
  userId: number | null;
  name: string;
  description: string | null;
  place: string;
  isActive: boolean;
  exercisesCount?: number;
  exercises?: ProgramExerciseDto[];
  createdAt: string;
}

// ─── Входные DTO этапа 3 (формируются валидаторами middlewares/validate.ts) ───

/** Параметры списка упражнений (docs/api.md §3). muscle/equipment — канонические токены.
 *  scope: all = общие + персональные пользователя; shared = только базовые; mine = только свои. */
export interface ExerciseListQuery {
  page: number;
  limit: number;
  scope: 'all' | 'shared' | 'mine';
  place?: string;
  metric?: string;
  difficulty?: string;
  muscle?: string[];
  equipment?: string[];
  search?: string;
}

export interface CreateExerciseDto {
  name: string;
  description?: string;
  place: string;
  metric: string;
  muscleGroups: string[];
  difficulty: string;
  equipment?: string[];
}

export interface UpdateExerciseDto {
  name?: string;
  description?: string;
  place?: string;
  metric?: string;
  muscleGroups?: string[];
  difficulty?: string;
  equipment?: string[];
}

/** Параметры списка программ (docs/api.md §4). */
export interface ProgramListQuery {
  page: number;
  limit: number;
  scope: 'mine' | 'ready';
  place?: string;
  isActive?: boolean;
}

export interface CreateProgramDto {
  name: string;
  description?: string;
  place: string;
}

export interface UpdateProgramDto {
  name?: string;
  description?: string;
  place?: string;
}

export interface AddProgramExerciseDto {
  exerciseId: number;
  targetSets: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  targetDuration?: number | null;
  order?: number;
}

export interface UpdateProgramExerciseDto {
  exerciseId?: number;
  targetSets?: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  targetDuration?: number | null;
}

export interface ReorderDto {
  orders: Array<{ programExerciseId: number; order: number }>;
}
