import { AppError } from '../types/errors.js';
import type {
  ExerciseListQuery,
  ProgramListQuery,
  RegisterDto,
  LoginDto,
  UpdateProfileDto,
  CreateExerciseDto,
  UpdateExerciseDto,
  CreateProgramDto,
  UpdateProgramDto,
  AddProgramExerciseDto,
  UpdateProgramExerciseDto,
  ReorderDto,
  PublicProgramListQuery,
  ShareProgramDto,
  StartWorkoutDto,
  SaveWorkoutSetDto,
  SaveWorkoutResultDto,
  SaveWorkoutResultsDto,
  CompleteWorkoutDto,
  UpdateWorkoutNotesDto,
  WorkoutListQuery,
  StatsSummaryQuery,
  ExerciseStatsQuery,
} from '../types/dto.js';
import { canonToken } from '../lib/normalize.js';

/**
 * Валидация входных данных на границе контроллеров (docs/architecture.md §3).
 * Контракт на границе HTTP: любое отклонение — VALIDATION_ERROR 400
 * в едином формате ошибок (docs/api.md §1).
 * Этап 3: query-параметры списков и body упражнений/программ.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** bcrypt ограничивает пароль 72 байтами. */
const PASSWORD_MAX = 72;
const NAME_MAX = 50;

// Этап 3: словари и ограничения каталога
export const PLACES = ['home', 'outdoor', 'gym'] as const;
export const METRICS = ['reps', 'reps_weight', 'time'] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
/** Словарь групп мышц — значения вне словаря отклоняются у новых записей (существующие данные не трогаем). */
export const MUSCLE_TOKENS = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings',
  'glutes', 'abs', 'core', 'calves', 'full_body', 'cardio', 'other',
] as const;
/** Словарь инвентаря (docs/database.md §2.3). */
export const EQUIPMENT_TOKENS = [
  'dumbbell', 'kettlebell', 'barbell', 'bench', 'rack', 'cable_machine',
  'resistance_band', 'jump_rope', 'pullup_bar', 'dip_bars', 'treadmill',
  'exercise_bike', 'mat',
] as const;

const EXERCISE_NAME_MAX = 100;
const DESCRIPTION_MAX = 2000;
const MUSCLE_TOKENS_MAX = 5;
const TARGET_SETS_MAX = 20;
const TARGET_REPS_MAX = 1000;
const TARGET_WEIGHT_MAX = 1000;
const TARGET_DURATION_MAX = 6 * 3600; // сек, до 6 часов
const TARGET_REST_MAX = 3600; // сек, перерыв между подходами — до 1 часа
const SEARCH_MAX = 100;
const LIMIT_MAX = 100;

// Этап 4: лимиты тренировок (docs/api.md §5) — используются только парсерами этого файла.
const RESULTS_MAX = 50;
const SETS_MAX = 20;
const NOTES_MAX = 2000;
/** Максимальное значение Prisma Int. */
const REVISION_MAX = 2147483647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `Поле "${field}" обязательно и должно быть строкой`);
  }
  return value;
}

/** Валидирует данные регистрации (docs/api.md §2). */
export function parseRegisterDto(body: unknown): RegisterDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }

  const email = requireString(body, 'email').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new AppError('VALIDATION_ERROR', 'Некорректный email');
  }

  const password = requireString(body, 'password');
  if (password.length < 8 || password.length > PASSWORD_MAX) {
    throw new AppError('VALIDATION_ERROR', `Пароль должен содержать от 8 до ${PASSWORD_MAX} символов`);
  }

  const name = requireString(body, 'name').trim();
  if (name.length === 0 || name.length > NAME_MAX) {
    throw new AppError('VALIDATION_ERROR', `Имя обязательно и должно содержать до ${NAME_MAX} символов`);
  }

  return { email, password, name };
}

/** Валидирует данные входа (docs/api.md §2). */
export function parseLoginDto(body: unknown): LoginDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const email = requireString(body, 'email');
  const password = requireString(body, 'password');
  return { email, password };
}

/**
 * Валидирует редактирование профиля: допустимо имя и/или смена пароля.
 * Смена пароля требует текущий пароль.
 */
export function parseUpdateProfileDto(body: unknown): UpdateProfileDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }

  const dto: UpdateProfileDto = {};

  if (body.name !== undefined) {
    const name = requireString(body, 'name').trim();
    if (name.length === 0 || name.length > NAME_MAX) {
      throw new AppError('VALIDATION_ERROR', `Имя должно содержать от 1 до ${NAME_MAX} символов`);
    }
    dto.name = name;
  }

  if (body.newPassword !== undefined) {
    const newPassword = requireString(body, 'newPassword');
    if (newPassword.length < 8 || newPassword.length > PASSWORD_MAX) {
      throw new AppError('VALIDATION_ERROR', `Новый пароль должен содержать от 8 до ${PASSWORD_MAX} символов`);
    }
    const currentPassword = requireString(body, 'currentPassword');
    dto.newPassword = newPassword;
    dto.currentPassword = currentPassword;
  }

  if (dto.name === undefined && dto.newPassword === undefined) {
    throw new AppError('VALIDATION_ERROR', 'Передайте name и/или newPassword для обновления');
  }

  return dto;
}

// ─── Этап 3: query-параметры и body каталога (docs/api.md §3, §4) ───

function isRecordOfQuery(query: unknown): query is Record<string, unknown> {
  return typeof query === 'object' && query !== null && !Array.isArray(query);
}

function parsePositiveInt(raw: unknown, field: string, max?: number): number {
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || (max !== undefined && value > max)) {
    const range = max !== undefined ? `от 1 до ${max}` : 'положительным целым';
    throw new AppError('VALIDATION_ERROR', `Параметр "${field}" должен быть ${range}`);
  }
  return value;
}

function optionalEnum<T extends readonly string[]>(raw: unknown, field: string, values: T): T[number] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !values.includes(raw)) {
    throw new AppError('VALIDATION_ERROR', `Параметр "${field}" должен быть одним из: ${values.join(', ')}`);
  }
  return raw as T[number];
}

function optionalBool(raw: unknown, field: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new AppError('VALIDATION_ERROR', `Параметр "${field}" должен быть "true" или "false"`);
}

// ─── Этап 4: вспомогательные функции тренировок (docs/api.md §5) ───

/** Целое от 0 до max включительно (число или числовая строка); 0 разрешён — в отличие от parsePositiveInt. */
function parseNonNegativeInt(raw: unknown, field: string, max?: number): number {
  if (typeof raw === 'string' && raw.trim() === '') {
    throw new AppError('VALIDATION_ERROR', `Поле "${field}" должно быть неотрицательным целым`);
  }
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isFinite(value) ||
    (max !== undefined && value > max)
  ) {
    const range = max !== undefined ? `от 0 до ${max}` : 'неотрицательным целым';
    throw new AppError('VALIDATION_ERROR', `Поле "${field}" должно быть ${range}`);
  }
  return value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Дата YYYY-MM-DD: формат и реальное календарное существование (2026-02-30 отсекается).
 * Проверка через UTC и обратное сравнение с исходной строкой.
 */
function parseIsoDate(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
    throw new AppError('VALIDATION_ERROR', `Параметр "${field}" должен быть датой в формате YYYY-MM-DD`);
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new AppError('VALIDATION_ERROR', `Параметр "${field}" должен быть существующей датой`);
  }
  return raw;
}

/** Токены muscle/equipment: CSV-строка → канонические токены из словаря. */
function parseTokenList(raw: unknown, field: string, vocabulary: readonly string[]): string[] | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length > 300) {
    throw new AppError('VALIDATION_ERROR', `Параметр "${field}" должен быть CSV-строкой токенов`);
  }
  const tokens = raw.split(',').map(canonToken).filter((t) => t.length > 0);
  if (tokens.length === 0) {
    throw new AppError('VALIDATION_ERROR', `Параметр "${field}" должен содержать хотя бы один токен`);
  }
  for (const token of tokens) {
    if (!vocabulary.includes(token)) {
      throw new AppError('VALIDATION_ERROR', `Неизвестный токен "${token}" в параметре "${field}"`);
    }
  }
  return tokens;
}

/** GET /api/exercises — query-параметры списка (docs/api.md §3). */
export function parseExerciseListQuery(query: unknown): ExerciseListQuery {
  if (!isRecordOfQuery(query)) {
    throw new AppError('VALIDATION_ERROR', 'Некорректные query-параметры');
  }
  const scope = query.scope === undefined ? 'all' : query.scope;
  if (scope !== 'all' && scope !== 'shared' && scope !== 'mine') {
    throw new AppError('VALIDATION_ERROR', 'Параметр "scope" должен быть "all", "shared" или "mine"');
  }
  return {
    page: parsePositiveInt(query.page ?? '1', 'page'),
    limit: parsePositiveInt(query.limit ?? '20', 'limit', LIMIT_MAX),
    scope,
    place: optionalEnum(query.place, 'place', PLACES),
    metric: optionalEnum(query.metric, 'metric', METRICS),
    difficulty: optionalEnum(query.difficulty, 'difficulty', DIFFICULTIES),
    muscle: parseTokenList(query.muscle, 'muscle', MUSCLE_TOKENS),
    equipment: parseTokenList(query.equipment, 'equipment', EQUIPMENT_TOKENS),
    search: query.search === undefined ? undefined : String(query.search).slice(0, SEARCH_MAX),
  };
}

/** GET /api/programs — query-параметры списка (docs/api.md §4). */
export function parseProgramListQuery(query: unknown): ProgramListQuery {
  if (!isRecordOfQuery(query)) {
    throw new AppError('VALIDATION_ERROR', 'Некорректные query-параметры');
  }
  const scope = query.scope === undefined ? 'mine' : query.scope;
  if (scope !== 'mine' && scope !== 'ready') {
    throw new AppError('VALIDATION_ERROR', 'Параметр "scope" должен быть "mine" или "ready"');
  }
  return {
    page: parsePositiveInt(query.page ?? '1', 'page'),
    limit: parsePositiveInt(query.limit ?? '20', 'limit', LIMIT_MAX),
    scope,
    place: optionalEnum(query.place, 'place', PLACES),
    isActive: optionalBool(query.isActive, 'isActive'),
  };
}

/** Идентификатор из path-параметра. */
export function parseId(raw: string): number {
  return parsePositiveInt(raw, 'id');
}

/** Токены muscleGroups/equipment из body: массив строк → валидированные канонические токены.
 *  required=true (muscleGroups) — пустой массив запрещён; для equipment пустой массив
 *  валиден (означает «без инвентаря» → null). */
function parseBodyTokens(raw: unknown, field: string, vocabulary: readonly string[], required: boolean): string[] | undefined {
  if (raw === undefined) {
    if (required) {
      throw new AppError('VALIDATION_ERROR', `Поле "${field}" обязательно`);
    }
    return undefined;
  }
  const minTokens = required ? 1 : 0;
  if (!Array.isArray(raw) || raw.length < minTokens || raw.length > MUSCLE_TOKENS_MAX || !raw.every((t) => typeof t === 'string')) {
    throw new AppError('VALIDATION_ERROR', `Поле "${field}" должно быть массивом строк${required ? ' (непустым)' : ''} (до ${MUSCLE_TOKENS_MAX})`);
  }
  const tokens = [...new Set(raw.map((t) => canonToken(t as string)))];
  for (const token of tokens) {
    if (!vocabulary.includes(token)) {
      throw new AppError('VALIDATION_ERROR', `Неизвестный токен "${token}" в поле "${field}"`);
    }
  }
  return tokens;
}

function parseOptionalDescription(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw.length > DESCRIPTION_MAX) {
    throw new AppError('VALIDATION_ERROR', `Поле "description" должно быть строкой до ${DESCRIPTION_MAX} символов`);
  }
  return raw;
}

function parseOptionalTargetInt(raw: unknown, field: string, max: number): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  return parsePositiveInt(raw, field, max);
}

function parseOptionalTargetWeight(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > TARGET_WEIGHT_MAX) {
    throw new AppError('VALIDATION_ERROR', `Поле "targetWeight" должно быть числом от 0 до ${TARGET_WEIGHT_MAX}`);
  }
  return raw;
}

/** Разбор токенов упражнения + целевые значения, общие для POST/PUT. */
function parseExerciseCoreFields(
  body: Record<string, unknown>,
  required: boolean,
): Pick<CreateExerciseDto, 'place' | 'metric' | 'muscleGroups' | 'difficulty' | 'equipment'> {
  return {
    place: optionalEnum(body.place, 'place', PLACES) as string,
    metric: optionalEnum(body.metric, 'metric', METRICS) as string,
    muscleGroups: parseBodyTokens(body.muscleGroups, 'muscleGroups', MUSCLE_TOKENS, required) as string[],
    difficulty: optionalEnum(body.difficulty, 'difficulty', DIFFICULTIES) as string,
    equipment: parseBodyTokens(body.equipment ?? [], 'equipment', EQUIPMENT_TOKENS, false) ?? [],
  };
}

/** POST /api/exercises (docs/api.md §3). */
export function parseCreateExerciseDto(body: unknown): CreateExerciseDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const name = requireString(body, 'name').trim();
  if (name.length === 0 || name.length > EXERCISE_NAME_MAX) {
    throw new AppError('VALIDATION_ERROR', `Поле "name" должно содержать от 1 до ${EXERCISE_NAME_MAX} символов`);
  }
  const description = parseOptionalDescription(body.description);
  const core = parseExerciseCoreFields(body, true);
  if (core.difficulty === undefined) {
    throw new AppError('VALIDATION_ERROR', `Поле "difficulty" должно быть одним из: ${DIFFICULTIES.join(', ')}`);
  }
  return { name, description, ...core };
}

/** PUT /api/exercises/:id — любое подмножество полей. */
export function parseUpdateExerciseDto(body: unknown): UpdateExerciseDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const dto: UpdateExerciseDto = {};
  if (body.name !== undefined) {
    const name = requireString(body, 'name').trim();
    if (name.length === 0 || name.length > EXERCISE_NAME_MAX) {
      throw new AppError('VALIDATION_ERROR', `Поле "name" должно содержать от 1 до ${EXERCISE_NAME_MAX} символов`);
    }
    dto.name = name;
  }
  dto.description = parseOptionalDescription(body.description);
  if (body.place !== undefined) dto.place = optionalEnum(body.place, 'place', PLACES);
  if (body.metric !== undefined) dto.metric = optionalEnum(body.metric, 'metric', METRICS);
  if (body.difficulty !== undefined) dto.difficulty = optionalEnum(body.difficulty, 'difficulty', DIFFICULTIES);
  const muscleGroups = parseBodyTokens(body.muscleGroups, 'muscleGroups', MUSCLE_TOKENS, false);
  if (muscleGroups !== undefined) dto.muscleGroups = muscleGroups;
  const equipment = parseBodyTokens(body.equipment ?? [], 'equipment', EQUIPMENT_TOKENS, false);
  if (body.equipment !== undefined) dto.equipment = equipment;
  if (Object.keys(dto).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Передайте хотя бы одно поле для обновления');
  }
  return dto;
}

/** POST /api/programs (docs/api.md §4). */
export function parseCreateProgramDto(body: unknown): CreateProgramDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const name = requireString(body, 'name').trim();
  if (name.length === 0 || name.length > EXERCISE_NAME_MAX) {
    throw new AppError('VALIDATION_ERROR', `Поле "name" должно содержать от 1 до ${EXERCISE_NAME_MAX} символов`);
  }
  const description = parseOptionalDescription(body.description);
  const place = optionalEnum(body.place, 'place', PLACES);
  if (place === undefined) {
    throw new AppError('VALIDATION_ERROR', `Поле "place" должно быть одним из: ${PLACES.join(', ')}`);
  }
  return { name, description, place };
}

/** PUT /api/programs/:id — любое подмножество полей. */
export function parseUpdateProgramDto(body: unknown): UpdateProgramDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const dto: UpdateProgramDto = {};
  if (body.name !== undefined) {
    const name = requireString(body, 'name').trim();
    if (name.length === 0 || name.length > EXERCISE_NAME_MAX) {
      throw new AppError('VALIDATION_ERROR', `Поле "name" должно содержать от 1 до ${EXERCISE_NAME_MAX} символов`);
    }
    dto.name = name;
  }
  dto.description = parseOptionalDescription(body.description);
  if (body.place !== undefined) dto.place = optionalEnum(body.place, 'place', PLACES);
  if (body.isPublic !== undefined) {
    if (typeof body.isPublic !== 'boolean') {
      throw new AppError('VALIDATION_ERROR', 'Поле "isPublic" должно быть true или false');
    }
    dto.isPublic = body.isPublic;
  }
  if (Object.keys(dto).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Передайте хотя бы одно поле для обновления');
  }
  return dto;
}

// ─── Этап 5: публичная библиотека и отправка программы ───

/** GET /api/programs/public — пагинация, фильтр по месту, поиск по названию. */
export function parsePublicProgramListQuery(query: unknown): PublicProgramListQuery {
  if (!isRecordOfQuery(query)) {
    throw new AppError('VALIDATION_ERROR', 'Некорректные query-параметры');
  }
  const rawSearch = query.search === undefined ? undefined : String(query.search).trim();
  return {
    page: parsePositiveInt(query.page ?? '1', 'page'),
    limit: parsePositiveInt(query.limit ?? '20', 'limit', LIMIT_MAX),
    place: optionalEnum(query.place, 'place', PLACES),
    search: rawSearch ? rawSearch.slice(0, SEARCH_MAX) : undefined,
  };
}

/** POST /api/programs/:id/share — email получателя. */
export function parseShareProgramDto(body: unknown): ShareProgramDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const email = requireString(body, 'email').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw new AppError('VALIDATION_ERROR', 'Некорректный email');
  }
  return { email };
}

/** POST /api/programs/:id/exercises (docs/api.md §4). */
export function parseAddProgramExerciseDto(body: unknown): AddProgramExerciseDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const exerciseId = parsePositiveInt(body.exerciseId, 'exerciseId');
  const targetSets = body.targetSets === undefined ? 3 : parsePositiveInt(body.targetSets, 'targetSets', TARGET_SETS_MAX);
  return {
    exerciseId,
    targetSets,
    targetReps: parseOptionalTargetInt(body.targetReps, 'targetReps', TARGET_REPS_MAX),
    targetWeight: parseOptionalTargetWeight(body.targetWeight),
    targetDuration: parseOptionalTargetInt(body.targetDuration, 'targetDuration', TARGET_DURATION_MAX),
    restSec:
      body.restSec === undefined ? undefined : parseNonNegativeInt(body.restSec, 'restSec', TARGET_REST_MAX),
    order: body.order === undefined ? undefined : parsePositiveInt(body.order, 'order'),
  };
}

/** PUT /api/programs/:id/exercises/:programExerciseId. */
export function parseUpdateProgramExerciseDto(body: unknown): UpdateProgramExerciseDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const dto: UpdateProgramExerciseDto = {};
  if (body.exerciseId !== undefined) {
    dto.exerciseId = parsePositiveInt(body.exerciseId, 'exerciseId');
  }
  if (body.targetSets !== undefined) {
    dto.targetSets = parsePositiveInt(body.targetSets, 'targetSets', TARGET_SETS_MAX);
  }
  dto.targetReps = parseOptionalTargetInt(body.targetReps, 'targetReps', TARGET_REPS_MAX);
  dto.targetWeight = parseOptionalTargetWeight(body.targetWeight);
  dto.targetDuration = parseOptionalTargetInt(body.targetDuration, 'targetDuration', TARGET_DURATION_MAX);
  if (body.restSec !== undefined) {
    dto.restSec = parseNonNegativeInt(body.restSec, 'restSec', TARGET_REST_MAX);
  }
  if (Object.keys(dto).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Передайте хотя бы одно поле для обновления');
  }
  return dto;
}

/** PUT /api/programs/:id/exercises/order — пакетная перестановка. */
export function parseReorderDto(body: unknown): ReorderDto {
  if (!isRecord(body) || !Array.isArray(body.orders) || body.orders.length === 0 || body.orders.length > 100) {
    throw new AppError('VALIDATION_ERROR', 'Поле "orders" должно быть непустым массивом (до 100 элементов)');
  }
  const orders = body.orders.map((item) => {
    if (!isRecord(item)) {
      throw new AppError('VALIDATION_ERROR', 'Элементы "orders" должны быть объектами { programExerciseId, order }');
    }
    return {
      programExerciseId: parsePositiveInt(item.programExerciseId, 'programExerciseId'),
      order: parsePositiveInt(item.order, 'order'),
    };
  });
  return { orders };
}

// ─── Этап 4: body/query тренировок (docs/api.md §5) ───

/** POST /api/workouts — начало тренировки; без programId — свободная (docs/api.md §5). */
export function parseStartWorkoutDto(body: unknown): StartWorkoutDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const place = optionalEnum(body.place, 'place', PLACES);
  if (place === undefined) {
    throw new AppError('VALIDATION_ERROR', `Поле "place" должно быть одним из: ${PLACES.join(', ')}`);
  }
  const dto: StartWorkoutDto = { place };
  if (body.programId !== undefined) {
    dto.programId = parsePositiveInt(body.programId, 'programId');
  }
  return dto;
}

/** Boolean в body: строго true/false (строки отклоняются). */
function parseBodyBoolean(raw: unknown, field: string): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === true) return true;
  if (raw === false) return false;
  throw new AppError('VALIDATION_ERROR', `Поле "${field}" должно быть true или false`);
}

/** Заметка: строка до NOTES_MAX (пустая → null) или null. */
function parseOptionalNotes(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string' || raw.length > NOTES_MAX) {
    throw new AppError('VALIDATION_ERROR', `Поле "notes" должно быть строкой до ${NOTES_MAX} символов или null`);
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Подход в составе результата; skipped=true допускает только пустые значения полей. */
function parseSaveWorkoutSetDto(raw: unknown): SaveWorkoutSetDto {
  if (!isRecord(raw)) {
    throw new AppError('VALIDATION_ERROR', 'Элементы "sets" должны быть объектами { order, reps?, weight?, duration?, skipped? }');
  }
  const order = parsePositiveInt(raw.order, 'order', SETS_MAX);
  const skipped = parseBodyBoolean(raw.skipped, 'skipped');
  const reps = parseOptionalTargetInt(raw.reps, 'reps', TARGET_REPS_MAX);
  const weight = parseOptionalTargetWeight(raw.weight);
  const duration = parseOptionalTargetInt(raw.duration, 'duration', TARGET_DURATION_MAX);
  const hasValue = (v: number | null | undefined) => v !== undefined && v !== null;
  if (skipped === true && (hasValue(reps) || hasValue(weight) || hasValue(duration))) {
    throw new AppError('VALIDATION_ERROR', 'Пропущенный подход (skipped=true) допускает только отсутствие или null в reps/weight/duration');
  }
  return { order, skipped, reps, weight, duration };
}

/** PUT /api/workouts/:id/results — автосохранение: полная замена результатов и подходов (docs/api.md §5). */
export function parseSaveResultsDto(body: unknown): SaveWorkoutResultsDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  const revision = parseNonNegativeInt(body.revision, 'revision', REVISION_MAX);
  if (!Array.isArray(body.results) || body.results.length > RESULTS_MAX) {
    throw new AppError('VALIDATION_ERROR', `Поле "results" должно быть массивом (до ${RESULTS_MAX} элементов)`);
  }
  const resultOrders: number[] = [];
  const results = body.results.map((raw) => {
    if (!isRecord(raw)) {
      throw new AppError('VALIDATION_ERROR', 'Элементы "results" должны быть объектами { order, sets, programExerciseId?/exerciseId?, skipped?, notes? }');
    }
    const order = parsePositiveInt(raw.order, 'order', RESULTS_MAX);
    resultOrders.push(order);
    const skipped = parseBodyBoolean(raw.skipped, 'skipped');
    const notes = parseOptionalNotes(raw.notes);
    // Ровно один идентификатор: programExerciseId (план программы) или exerciseId (каталог)
    const hasProgramExerciseId = raw.programExerciseId !== undefined;
    const hasExerciseId = raw.exerciseId !== undefined;
    if (hasProgramExerciseId === hasExerciseId) {
      throw new AppError('VALIDATION_ERROR', 'Результат должен содержать ровно один идентификатор: programExerciseId или exerciseId');
    }
    if (!Array.isArray(raw.sets) || raw.sets.length > SETS_MAX) {
      throw new AppError('VALIDATION_ERROR', `Поле "sets" должно быть массивом (до ${SETS_MAX} подходов)`);
    }
    if (skipped === true && raw.sets.length > 0) {
      throw new AppError('VALIDATION_ERROR', 'Пропущенный результат (skipped=true) допускает только пустой массив "sets"');
    }
    const setOrders: number[] = [];
    const sets = raw.sets.map((s) => {
      const set = parseSaveWorkoutSetDto(s);
      setOrders.push(set.order);
      return set;
    });
    if (new Set(setOrders).size !== setOrders.length) {
      throw new AppError('VALIDATION_ERROR', 'Поле "order" подходов должно быть уникальным');
    }
    const dto: SaveWorkoutResultDto = { order, skipped, notes: notes ?? null, sets };
    if (hasProgramExerciseId) {
      dto.programExerciseId = parsePositiveInt(raw.programExerciseId, 'programExerciseId');
    } else {
      dto.exerciseId = parsePositiveInt(raw.exerciseId, 'exerciseId');
    }
    return dto;
  });
  if (new Set(resultOrders).size !== resultOrders.length) {
    throw new AppError('VALIDATION_ERROR', 'Поле "order" результатов должно быть уникальным');
  }
  return { revision, results };
}

/** POST /api/workouts/:id/complete — завершение; revision для CAS (docs/api.md §5). */
export function parseCompleteWorkoutDto(body: unknown): CompleteWorkoutDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  return { revision: parseNonNegativeInt(body.revision, 'revision', REVISION_MAX) };
}

/** PUT /api/workouts/:id — заметки; notes обязательно: строка до NOTES_MAX или null (docs/api.md §5). */
export function parseUpdateWorkoutNotesDto(body: unknown): UpdateWorkoutNotesDto {
  if (!isRecord(body)) {
    throw new AppError('VALIDATION_ERROR', 'Тело запроса должно быть JSON-объектом');
  }
  if (!('notes' in body)) {
    throw new AppError('VALIDATION_ERROR', 'Поле "notes" обязательно');
  }
  const notes = parseOptionalNotes(body.notes);
  if (notes === undefined) {
    throw new AppError('VALIDATION_ERROR', `Поле "notes" должно быть строкой до ${NOTES_MAX} символов или null`);
  }
  return { notes };
}

/** GET /api/workouts — query-параметры истории (docs/api.md §5). */
export function parseWorkoutListQuery(query: unknown): WorkoutListQuery {
  if (!isRecordOfQuery(query)) {
    throw new AppError('VALIDATION_ERROR', 'Некорректные query-параметры');
  }
  const from = query.from === undefined ? undefined : parseIsoDate(query.from, 'from');
  const to = query.to === undefined ? undefined : parseIsoDate(query.to, 'to');
  if (from !== undefined && to !== undefined && from > to) {
    throw new AppError('VALIDATION_ERROR', 'Параметр "from" не может быть позже "to"');
  }
  return {
    page: parsePositiveInt(query.page ?? '1', 'page'),
    limit: parsePositiveInt(query.limit ?? '20', 'limit', LIMIT_MAX),
    place: optionalEnum(query.place, 'place', PLACES),
    from,
    to,
  };
}

// ─── Этап 4.4: query-параметры статистики (docs/api.md §6) ───

/** Лимит точек истории упражнения по умолчанию. */
const STATS_LIMIT_DEFAULT = 50;

/** Диапазон дат статистики: YYYY-MM-DD (UTC), from <= to; to включительно. */
function parseStatsDateRange(query: Record<string, unknown>): { from?: string; to?: string } {
  const from = query.from === undefined ? undefined : parseIsoDate(query.from, 'from');
  const to = query.to === undefined ? undefined : parseIsoDate(query.to, 'to');
  if (from !== undefined && to !== undefined && from > to) {
    throw new AppError('VALIDATION_ERROR', 'Параметр "from" не может быть позже "to"');
  }
  return { from, to };
}

/** GET /api/stats/summary — период from/to (YYYY-MM-DD UTC). */
export function parseStatsSummaryQuery(query: unknown): StatsSummaryQuery {
  if (!isRecordOfQuery(query)) {
    throw new AppError('VALIDATION_ERROR', 'Некорректные query-параметры');
  }
  return parseStatsDateRange(query);
}

/** GET /api/stats/exercises/:exerciseId — период и limit (1..100, default 50). */
export function parseExerciseStatsQuery(query: unknown): ExerciseStatsQuery {
  if (!isRecordOfQuery(query)) {
    throw new AppError('VALIDATION_ERROR', 'Некорректные query-параметры');
  }
  return {
    ...parseStatsDateRange(query),
    limit: parsePositiveInt(query.limit ?? STATS_LIMIT_DEFAULT, 'limit', LIMIT_MAX),
  };
}
