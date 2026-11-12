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
const SEARCH_MAX = 100;
const LIMIT_MAX = 100;

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
  return {
    page: parsePositiveInt(query.page ?? '1', 'page'),
    limit: parsePositiveInt(query.limit ?? '20', 'limit', LIMIT_MAX),
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
  if (Object.keys(dto).length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Передайте хотя бы одно поле для обновления');
  }
  return dto;
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
