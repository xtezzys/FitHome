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
  /** Перерыв между подходами, сек (0 — без перерыва). */
  restSec: number;
  exercise: ExerciseDto;
}

/** Программа в ответах API (docs/api.md §4). authorName — только для чужих публичных. */
export interface ProgramDto {
  id: number;
  userId: number | null;
  name: string;
  description: string | null;
  place: string;
  isActive: boolean;
  isPublic: boolean;
  publishedAt: string | null;
  authorName: string | null;
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
  /** Публикация в общую библиотеку (только владелец). */
  isPublic?: boolean;
}

export interface AddProgramExerciseDto {
  exerciseId: number;
  targetSets: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  targetDuration?: number | null;
  /** Перерыв между подходами, сек; не задан — 90 по умолчанию. */
  restSec?: number;
  order?: number;
}

export interface UpdateProgramExerciseDto {
  exerciseId?: number;
  targetSets?: number;
  targetReps?: number | null;
  targetWeight?: number | null;
  targetDuration?: number | null;
  /** Перерыв между подходами, сек (0 — без перерыва). */
  restSec?: number;
}

export interface ReorderDto {
  orders: Array<{ programExerciseId: number; order: number }>;
}

// ─── Этап 5: обмен программами ───

/** GET /api/programs/public — поиск и фильтр публичной библиотеки. */
export interface PublicProgramListQuery {
  page: number;
  limit: number;
  place?: string;
  search?: string;
}

/** POST /api/programs/:id/share — отправка по email получателя. */
export interface ShareProgramDto {
  email: string;
}

/** Входящая передача в списке получателя. */
export interface IncomingShareDto {
  id: number;
  programId: number;
  programName: string;
  fromUserName: string;
  status: string;
  createdAt: string;
}

/** Исходящая передача в списке отправителя. */
export interface OutgoingShareDto {
  id: number;
  programId: number;
  programName: string;
  toUserName: string;
  status: string;
  createdAt: string;
}

/** Ответ на отправку программы. */
export interface ProgramShareCreatedDto {
  id: number;
  programId: number;
  toUserName: string;
  status: string;
  createdAt: string;
}

/** GET /api/programs/shares/:shareId — полученная программа для просмотра. */
export interface IncomingShareDetailDto {
  shareId: number;
  fromUserName: string;
  status: string;
  program: ProgramDto;
}

// ─── Этап 4: тренировки (docs/api.md §5, формируются валидаторами middlewares/validate.ts) ───

/** POST /api/workouts — начало тренировки. Без programId — свободная тренировка. */
export interface StartWorkoutDto {
  place: string;
  programId?: number;
}

/** Подход в составе сохраняемого результата. Поля по метрике результата проверяет сервис. */
export interface SaveWorkoutSetDto {
  order: number;
  reps?: number | null;
  weight?: number | null;
  duration?: number | null;
  skipped?: boolean;
}

/**
 * Результат одного упражнения в тренировке. Полная замена: идентификаторы
 * результатов клиент не передаёт — состав синхронизируется из ответа.
 * - programExerciseId — ссылка на ProgramExerciseDto.programExerciseId
 *   (элемент плана программной тренировки; допустим только в программной);
 * - exerciseId — ссылка на ExerciseDto.id
 *   (только для свободной тренировки; в программной отклоняется 400);
 * - одновременно оба поля передавать нельзя;
 * - клиентские exerciseName/exerciseMetric в DTO отсутствуют —
 *   снапшоты формирует сервер из БД.
 */
export interface SaveWorkoutResultDto {
  order: number;
  skipped?: boolean;
  notes?: string | null;
  sets: SaveWorkoutSetDto[];
  programExerciseId?: number;
  exerciseId?: number;
}

/** PUT /api/workouts/:id/results — автосохранение черновика: полная замена результатов и подходов. */
export interface SaveWorkoutResultsDto {
  revision: number;
  results: SaveWorkoutResultDto[];
}

/** POST /api/workouts/:id/complete — завершение; revision для CAS по активной тренировке. */
export interface CompleteWorkoutDto {
  revision: number;
}

/** PUT /api/workouts/:id — заметки (в т.ч. для завершённой); null — очистка. */
export interface UpdateWorkoutNotesDto {
  notes: string | null;
}

/** GET /api/workouts — query-параметры истории; from/to — даты YYYY-MM-DD (UTC). */
export interface WorkoutListQuery {
  page: number;
  limit: number;
  place?: string;
  from?: string;
  to?: string;
}

/** Подход в ответах API (docs/api.md §5). */
export interface WorkoutSetDto {
  id: number;
  order: number;
  reps: number | null;
  weight: number | null;
  duration: number | null;
  skipped: boolean;
}

/** Результат упражнения в ответах API (docs/api.md §5). weight — число или null. */
export interface WorkoutResultDto {
  id: number;
  exerciseId: number | null;
  programExerciseId: number | null;
  exerciseName: string;
  exerciseMetric: string;
  order: number;
  skipped: boolean;
  notes: string | null;
  sets: WorkoutSetDto[];
}

/** Тренировка в ответах API (docs/api.md §5). */
export interface WorkoutDto {
  id: number;
  userId: number;
  programId: number | null;
  programName: string | null;
  place: string;
  status: string;
  revision: number;
  startedAt: string;
  completedAt: string | null;
  durationSec: number | null;
  notes: string | null;
  results: WorkoutResultDto[];
}

/** Элемент истории (docs/api.md §5): только completed; счётчики из агрегатов запроса. */
export interface WorkoutListItemDto {
  id: number;
  programId: number | null;
  programName: string | null;
  place: string;
  startedAt: string;
  durationSec: number | null;
  notes: string | null;
  exercisesCount: number;
  totalSets: number;
}

// ─── Этап 4.4: статистика (docs/api.md §6) ───

/** GET /api/stats/summary — период YYYY-MM-DD (UTC); границы включительно. */
export interface StatsSummaryQuery {
  from?: string;
  to?: string;
}

/** Агрегаты одного среза статистики (день/неделя). */
export interface StatsBucketDto {
  workoutsCount: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
}

/** Срез по дню: date — YYYY-MM-DD UTC. */
export interface StatsDayBucketDto extends StatsBucketDto {
  date: string;
}

/** Срез по неделе: weekStart — понедельник, YYYY-MM-DD UTC. */
export interface StatsWeekBucketDto extends StatsBucketDto {
  weekStart: string;
}

/** Количество тренировок по местам; отсутствующие места — 0. */
export interface StatsByPlaceDto {
  home: number;
  outdoor: number;
  gym: number;
}

/** GET /api/stats/summary — сводка завершённых тренировок за период. */
export interface StatsSummaryDto {
  workoutsCount: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  byPlace: StatsByPlaceDto;
  byDay: StatsDayBucketDto[];
  byWeek: StatsWeekBucketDto[];
}

/** GET /api/stats/exercises/:exerciseId — период и лимит точек (default 50, max 100). */
export interface ExerciseStatsQuery {
  from?: string;
  to?: string;
  limit: number;
}

/**
 * Точка истории упражнения. Значения берутся из snapshot-метрики результата:
 * reps/reps_weight — totalReps и bestReps; reps_weight — totalVolume и bestWeight;
 * time — только totalSets и bestDuration.
 */
export interface ExerciseStatsPointDto {
  workoutId: number;
  startedAt: string;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  bestReps: number | null;
  bestWeight: number | null;
  bestDuration: number | null;
}

/** Серия точек одной snapshot-метрики; разные метрики не смешиваются. */
export interface ExerciseStatsSeriesDto {
  metric: string;
  points: ExerciseStatsPointDto[];
}

/** GET /api/stats/exercises/:exerciseId — история по метрикам + текущая метрика упражнения. */
export interface ExerciseStatsDto {
  exerciseId: number;
  exerciseName: string;
  currentMetric: string;
  metricChanged: boolean;
  series: ExerciseStatsSeriesDto[];
}
