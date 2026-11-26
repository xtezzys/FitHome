import type { Prisma } from '@prisma/client';
import type { ProgramWithExercises } from '../repositories/program.repository.js';
import type {
  CreateWorkoutSetData,
  WorkoutDetailRow,
  WorkoutListRow,
  WorkoutResultRow,
  WorkoutSetRow,
} from '../repositories/workout.repository.js';
import type {
  CompleteWorkoutDto,
  PaginationMeta,
  SaveWorkoutResultsDto,
  SaveWorkoutSetDto,
  StartWorkoutDto,
  UpdateWorkoutNotesDto,
  WorkoutDto,
  WorkoutListItemDto,
  WorkoutListQuery,
  WorkoutResultDto,
  WorkoutSetDto,
} from '../types/dto.js';
import { AppError } from '../types/errors.js';
import * as exerciseRepo from '../repositories/exercise.repository.js';
import * as programRepo from '../repositories/program.repository.js';
import * as workoutRepo from '../repositories/workout.repository.js';

/**
 * Бизнес-логика тренировок (docs/api.md §5, план этапа 4 v3).
 *
 * Правила доступа: все проверки владения дают 404 (не раскрываем существование
 * чужих объектов). Prisma используется только через repositories.
 *
 * CAS по revision: где необходимо — updateMany с условием
 * id + userId + status + revision; при count === 0 транзакция прерывается,
 * актуальная revision читается ТОЛЬКО после отката и попадает в текст 409.
 */

// ─── DTO-мапперы ───

function setToDto(row: WorkoutSetRow): WorkoutSetDto {
  return {
    id: row.id,
    order: row.order,
    reps: row.reps,
    weight: row.weight === null ? null : Number(row.weight),
    duration: row.duration,
    skipped: row.skipped,
  };
}

function resultToDto(row: WorkoutResultRow): WorkoutResultDto {
  return {
    id: row.id,
    exerciseId: row.exerciseId,
    programExerciseId: row.programExerciseId,
    exerciseName: row.exerciseName,
    exerciseMetric: row.exerciseMetric,
    order: row.order,
    skipped: row.skipped,
    notes: row.notes,
    sets: row.sets.map(setToDto),
  };
}

function workoutToDto(row: WorkoutDetailRow): WorkoutDto {
  return {
    id: row.id,
    userId: row.userId,
    programId: row.programId,
    programName: row.programName,
    place: row.place,
    status: row.status,
    revision: row.revision,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    durationSec: row.durationSec,
    notes: row.notes,
    results: row.results.map(resultToDto),
  };
}

/** Элемент истории: счётчики берутся из фильтрованных агрегатов запроса. */
function historyItemToDto(row: WorkoutListRow): WorkoutListItemDto {
  return {
    id: row.id,
    programId: row.programId,
    programName: row.programName,
    place: row.place,
    startedAt: row.startedAt.toISOString(),
    durationSec: row.durationSec,
    notes: row.notes,
    exercisesCount: row._count.results,
    totalSets: row.results.reduce((sum, item) => sum + item._count.sets, 0),
  };
}

/** Повторное чтение тренировки после изменения: 404, если запись исчезла. */
async function loadWorkoutDto(workoutId: number): Promise<WorkoutDto> {
  const row = await workoutRepo.findWorkoutById(workoutId);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Тренировка не найдена');
  }
  return workoutToDto(row);
}

/**
 * После неудачного CAS: фактическое состояние определяет ответ.
 * Вызывается ТОЛЬКО после отката/завершения транзакции.
 */
async function resolveStaleWorkout(userId: number, workoutId: number): Promise<never> {
  const current = await workoutRepo.findWorkoutRevision(workoutId);
  if (!current || current.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Тренировка не найдена');
  }
  if (current.status === 'completed') {
    throw new AppError('CONFLICT', 'Тренировка уже завершена');
  }
  if (current.status === 'cancelled') {
    throw new AppError('CONFLICT', 'Тренировка была отменена');
  }
  throw new AppError(
    'CONFLICT',
    `Ревизия устарела, актуальная: ${current.revision}; перезагрузите тренировку`,
  );
}

// ─── Распознавание конфликта активной тренировки ───

/**
 * Фактическая форма ошибки Prisma 6.19.3 (подтверждена экспериментом на
 * временной SQLite-БД): PrismaClientKnownRequestError, code 'P2002',
 * meta = { modelName: 'Workout', target: ['userId'] }. Имя частичного индекса
 * в meta не передаётся. На пути вставки в workouts это единственный unique-
 * констрейнт, поэтому сочетание modelName+target однозначно; любые другие
 * P2002 не маскируются в 409.
 */
function isActiveWorkoutConflict(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; meta?: { modelName?: unknown; target?: unknown } };
  if (e.code !== 'P2002') return false;
  if (e.meta?.modelName !== 'Workout') return false;
  return Array.isArray(e.meta.target) && e.meta.target.includes('userId');
}

/**
 * Prisma P2025 (record to update/delete not found): запись удалена между
 * предварительной проверкой и записью. Операции адресуются по id, поэтому
 * P2025 однозначно означает отсутствие тренировки — контракт требует 404.
 */
function isRecordNotFound(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { code?: unknown }).code === 'P2025';
}

function activeConflictError(activeId?: number): AppError {
  return new AppError(
    'CONFLICT',
    activeId !== undefined
      ? `У вас уже есть активная тренировка (id=${activeId})`
      : 'У вас уже есть активная тренировка',
  );
}

// ─── Старт тренировки ───

/**
 * POST /api/workouts — начало тренировки.
 * - программная: программа доступна (своя или готовая), иначе 404;
 * - Workout и все WorkoutResult создаются в ОДНОЙ транзакции (один tx):
 *   ошибка любого результата откатывает создание тренировки;
 * - снимки названия/метрики упражнений формируются только сервером из БД;
 * - конкурентный дубль активной тренировки (P2002 частичного индекса) → 409.
 */
export async function startWorkout(userId: number, dto: StartWorkoutDto): Promise<WorkoutDto> {
  const active = await workoutRepo.findActiveByUser(userId);
  if (active) {
    throw activeConflictError(active.id);
  }

  // Программа: своя или готовая; чужая/несуществующая — 404 без раскрытия
  let program: ProgramWithExercises | null = null;
  if (dto.programId !== undefined) {
    program = await programRepo.findProgramById(dto.programId);
    if (!program || (program.userId !== null && program.userId !== userId)) {
      throw new AppError('NOT_FOUND', 'Программа не найдена');
    }
  }

  let workoutId: number;
  try {
    workoutId = await workoutRepo.runTransaction(async (tx) => {
      const workout = await workoutRepo.createWorkout(
        {
          userId,
          programId: program?.id ?? null,
          programName: program?.name ?? null,
          place: dto.place,
        },
        tx,
      );
      if (program) {
        for (const pe of program.exercises) {
          // Доступность упражнения: общее или персональное текущего пользователя
          if (pe.exercise.userId !== null && pe.exercise.userId !== userId) {
            throw new AppError('NOT_FOUND', 'Упражнение не найдено');
          }
          await workoutRepo.createWorkoutResult(
            {
              workoutId: workout.id,
              exerciseId: pe.exerciseId,
              programExerciseId: pe.id,
              exerciseName: pe.exercise.name,
              exerciseMetric: pe.exercise.metric,
              order: pe.order,
            },
            tx,
          );
        }
      }
      return workout.id;
    }, { timeout: 15_000 });
  } catch (err) {
    if (isActiveWorkoutConflict(err)) {
      const winner = await workoutRepo.findActiveByUser(userId);
      throw activeConflictError(winner?.id);
    }
    throw err;
  }

  const row = await workoutRepo.findWorkoutById(workoutId);
  if (!row) {
    throw new AppError('INTERNAL_ERROR', 'Тренировка не создана');
  }
  return workoutToDto(row);
}

// ─── Активная тренировка ───

/** GET /api/workouts/active — незавершённая тренировка с результатами и подходами; нет — 404. */
export async function getActiveWorkout(userId: number): Promise<WorkoutDto> {
  const row = await workoutRepo.findActiveByUser(userId);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Активная тренировка не найдена');
  }
  return workoutToDto(row);
}

// ─── Сохранение результатов (полная замена) ───

/**
 * Внутренний сигнал неудачного CAS: выбрасывается ВНУТРИ транзакции, чтобы
 * Prisma откатила удаление/вставки. Актуальная revision читается только
 * после отката — иначе увидели бы промежуточное состояние.
 */
class StaleRevisionError extends Error {
  constructor() {
    super('Stale workout revision');
    this.name = 'StaleRevisionError';
  }
}

/** orders должны быть перестановкой 1..N (пустой список допустим). */
function assertSequentialOrders(orders: number[], label: string): void {
  const sorted = [...orders].sort((a, b) => a - b);
  const ok = sorted.every((order, index) => order === index + 1);
  if (!ok) {
    throw new AppError(
      'VALIDATION_ERROR',
      sorted.length === 0
        ? `Некорректная нумерация ${label}`
        : `Нарушена нумерация ${label}: ожидается 1..${sorted.length}`,
    );
  }
}

/**
 * Приведение подходов к метрике упражнения (снапшот из БД, не из запроса):
 * - reps:         reps обязателен, weight/duration = null;
 * - reps_weight:  reps и weight обязательны, duration = null;
 * - time:         duration обязателен, reps/weight = null;
 * - skipped:      все значения null независимо от метрики.
 * Клиентские значения несовместимых полей игнорируются, а не сохраняются.
 */
function prepareSets(
  metric: string,
  sets: SaveWorkoutSetDto[],
  resultOrder: number,
): CreateWorkoutSetData[] {
  return sets.map((set) => {
    if (set.skipped === true) {
      return { order: set.order, reps: null, weight: null, duration: null, skipped: true };
    }
    const where = `результат #${resultOrder}, подход #${set.order}`;
    switch (metric) {
      case 'reps':
        if (set.reps === null || set.reps === undefined) {
          throw new AppError('VALIDATION_ERROR', `Для метрики «reps» обязателен reps (${where})`);
        }
        return { order: set.order, reps: set.reps, weight: null, duration: null, skipped: false };
      case 'reps_weight':
        if (set.reps === null || set.reps === undefined) {
          throw new AppError('VALIDATION_ERROR', `Для метрики «reps_weight» обязателен reps (${where})`);
        }
        if (set.weight === null || set.weight === undefined) {
          throw new AppError('VALIDATION_ERROR', `Для метрики «reps_weight» обязателен weight (${where})`);
        }
        return { order: set.order, reps: set.reps, weight: set.weight, duration: null, skipped: false };
      case 'time':
        if (set.duration === null || set.duration === undefined) {
          throw new AppError('VALIDATION_ERROR', `Для метрики «time» обязателен duration (${where})`);
        }
        return { order: set.order, reps: null, weight: null, duration: set.duration, skipped: false };
      default:
        // Метрика приходит из БД — неизвестное значение означает рассинхрон данных.
        throw new AppError('INTERNAL_ERROR', `Неизвестная метрика упражнения: ${metric}`);
    }
  });
}

interface PreparedResult {
  exerciseId: number;
  programExerciseId: number | null;
  exerciseName: string;
  exerciseMetric: string;
  order: number;
  skipped: boolean;
  notes: string | null;
  sets: CreateWorkoutSetData[];
}

/**
 * PUT /api/workouts/:id/results — автосохранение черновика.
 *
 * Полная замена результатов и подходов в одной транзакции:
 * 1) тренировка существует и принадлежит пользователю (иначе 404),
 *    статус in_progress (иначе 409);
 * 2) order результатов и подходов — перестановка 1..N (иначе 400);
 * 3) снапшоты названия/метрики формируются сервером:
 *    - программная тренировка: только programExerciseId из этой программы,
 *      упражнение доступно пользователю;
 *    - свободная: только exerciseId, упражнение общее или своё;
 * 4) CAS по revision + удаление старых результатов/подходов + вставка новых;
 *    при count === 0 транзакция откатывается, и только затем читается
 *    актуальная revision для 409 (или фактический статус).
 */
export async function saveWorkoutResults(
  userId: number,
  workoutId: number,
  dto: SaveWorkoutResultsDto,
): Promise<WorkoutDto> {
  const workout = await workoutRepo.findWorkoutById(workoutId);
  if (!workout || workout.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Тренировка не найдена');
  }
  if (workout.status !== 'in_progress') {
    throw new AppError('CONFLICT', 'Тренировка уже завершена или отменена');
  }

  assertSequentialOrders(dto.results.map((r) => r.order), 'результатов');
  for (const result of dto.results) {
    assertSequentialOrders(result.sets.map((s) => s.order), `подходов результата #${result.order}`);
  }

  const prepared: PreparedResult[] = [];
  for (const result of dto.results) {
    if (workout.programId !== null) {
      if (result.programExerciseId === undefined) {
        throw new AppError(
          'VALIDATION_ERROR',
          `В программной тренировке для результата #${result.order} обязателен programExerciseId`,
        );
      }
      if (result.exerciseId !== undefined) {
        throw new AppError(
          'VALIDATION_ERROR',
          `В программной тренировке exerciseId не допускается (результат #${result.order})`,
        );
      }
      const pe = await programRepo.findProgramExerciseById(result.programExerciseId);
      if (!pe || pe.programId !== workout.programId) {
        throw new AppError('NOT_FOUND', 'Упражнение программы не найдено');
      }
      if (pe.exercise.userId !== null && pe.exercise.userId !== userId) {
        throw new AppError('NOT_FOUND', 'Упражнение не найдено');
      }
      prepared.push({
        exerciseId: pe.exerciseId,
        programExerciseId: pe.id,
        exerciseName: pe.exercise.name,
        exerciseMetric: pe.exercise.metric,
        order: result.order,
        skipped: result.skipped ?? false,
        notes: result.notes ?? null,
        sets: prepareSets(pe.exercise.metric, result.sets, result.order),
      });
      continue;
    }

    if (result.exerciseId === undefined) {
      throw new AppError(
        'VALIDATION_ERROR',
        `В свободной тренировке для результата #${result.order} обязателен exerciseId`,
      );
    }
    if (result.programExerciseId !== undefined) {
      throw new AppError(
        'VALIDATION_ERROR',
        `В свободной тренировке programExerciseId не допускается (результат #${result.order})`,
      );
    }
    const exercise = await exerciseRepo.findExerciseById(result.exerciseId);
    if (!exercise || (exercise.userId !== null && exercise.userId !== userId)) {
      throw new AppError('NOT_FOUND', 'Упражнение не найдено');
    }
    prepared.push({
      exerciseId: exercise.id,
      programExerciseId: null,
      exerciseName: exercise.name,
      exerciseMetric: exercise.metric,
      order: result.order,
      skipped: result.skipped ?? false,
      notes: result.notes ?? null,
      sets: prepareSets(exercise.metric, result.sets, result.order),
    });
  }

  try {
    await workoutRepo.runTransaction(
      async (tx) => {
        const { count } = await workoutRepo.casUpdateWorkout(
          { id: workoutId, userId, status: 'in_progress', revision: dto.revision },
          {},
          tx,
        );
        if (count !== 1) {
          throw new StaleRevisionError();
        }
        await workoutRepo.deleteWorkoutResults(workoutId, tx);
        for (const item of prepared) {
          const created = await workoutRepo.createWorkoutResult(
            {
              workoutId,
              exerciseId: item.exerciseId,
              programExerciseId: item.programExerciseId,
              exerciseName: item.exerciseName,
              exerciseMetric: item.exerciseMetric,
              order: item.order,
              skipped: item.skipped,
              notes: item.notes,
            },
            tx,
          );
          await workoutRepo.createWorkoutSets(created.id, item.sets, tx);
        }
      },
      { timeout: 15_000 },
    );
  } catch (err) {
    if (!(err instanceof StaleRevisionError)) {
      throw err;
    }
    // Транзакция уже откачена — читаем фактическое состояние.
    await resolveStaleWorkout(userId, workoutId);
  }

  return loadWorkoutDto(workoutId);
}

// ─── Завершение и отмена ───

/**
 * POST /api/workouts/:id/complete — завершение активной тренировки.
 * completedAt и durationSec рассчитывает только сервер; CAS по revision
 * защищает от параллельного сохранения/отмены. Один UPDATE атомарен,
 * поэтому отдельная транзакция не требуется.
 */
export async function completeWorkout(
  userId: number,
  workoutId: number,
  dto: CompleteWorkoutDto,
): Promise<WorkoutDto> {
  const workout = await workoutRepo.findWorkoutById(workoutId);
  if (!workout || workout.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Тренировка не найдена');
  }
  if (workout.status === 'completed') {
    throw new AppError('CONFLICT', 'Тренировка уже завершена');
  }
  if (workout.status === 'cancelled') {
    throw new AppError('CONFLICT', 'Тренировка была отменена');
  }

  const completedAt = new Date();
  const durationSec = Math.max(
    0,
    Math.floor((completedAt.getTime() - workout.startedAt.getTime()) / 1000),
  );

  const { count } = await workoutRepo.casUpdateWorkout(
    { id: workoutId, userId, status: 'in_progress', revision: dto.revision },
    { status: 'completed', completedAt, durationSec },
  );
  if (count !== 1) {
    await resolveStaleWorkout(userId, workoutId);
  }

  return loadWorkoutDto(workoutId);
}

/**
 * POST /api/workouts/:id/cancel — отмена активной тренировки.
 * - повторная отмена идемпотентна: уже cancelled → тот же DTO без инкремента revision;
 * - завершённую отменить нельзя (409);
 * - CAS по revision с ограниченным числом повторов: конкурентное автосохранение
 *   меняет revision, поэтому при count === 0 перечитываем состояние и повторяем
 *   с актуальной revision; параллельная отмена даёт идемпотентный ответ.
 */
export async function cancelWorkout(userId: number, workoutId: number): Promise<WorkoutDto> {
  const workout = await workoutRepo.findWorkoutById(workoutId);
  if (!workout || workout.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Тренировка не найдена');
  }
  if (workout.status === 'completed') {
    throw new AppError('CONFLICT', 'Завершённую тренировку нельзя отменить');
  }
  if (workout.status === 'cancelled') {
    return workoutToDto(workout);
  }

  let revision = workout.revision;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { count } = await workoutRepo.casUpdateWorkout(
      { id: workoutId, userId, status: 'in_progress', revision },
      { status: 'cancelled' },
    );
    if (count === 1) {
      return loadWorkoutDto(workoutId);
    }

    const current = await workoutRepo.findWorkoutRevision(workoutId);
    if (!current || current.userId !== userId) {
      throw new AppError('NOT_FOUND', 'Тренировка не найдена');
    }
    if (current.status === 'cancelled') {
      return loadWorkoutDto(workoutId);
    }
    if (current.status === 'completed') {
      throw new AppError('CONFLICT', 'Завершённую тренировку нельзя отменить');
    }
    revision = current.revision;
  }
  throw new AppError('CONFLICT', 'Не удалось отменить тренировку, повторите попытку');
}

// ─── Чтение, заметки, история, удаление ───

/** GET /api/workouts/:id — детали доступны только владельцу; чужое/нет → 404. */
export async function getWorkout(userId: number, workoutId: number): Promise<WorkoutDto> {
  const row = await workoutRepo.findWorkoutById(workoutId);
  if (!row || row.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Тренировка не найдена');
  }
  return workoutToDto(row);
}

/**
 * PUT /api/workouts/:id — заметки; доступно в любом статусе.
 * revision не инкрементируется: заметки не конфликтуют с автосохранением
 * черновика и завершением (CAS по revision остаётся валидным).
 * Предварительная проверка — лёгкая (findWorkoutRevision, без results/sets);
 * если запись удалена между проверкой и UPDATE (P2025) — тот же 404.
 */
export async function updateWorkoutNotes(
  userId: number,
  workoutId: number,
  dto: UpdateWorkoutNotesDto,
): Promise<WorkoutDto> {
  const workout = await workoutRepo.findWorkoutRevision(workoutId);
  if (!workout || workout.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Тренировка не найдена');
  }
  try {
    await workoutRepo.updateWorkoutNotes(workoutId, dto.notes);
  } catch (err) {
    if (isRecordNotFound(err)) {
      throw new AppError('NOT_FOUND', 'Тренировка не найдена');
    }
    throw err;
  }
  return loadWorkoutDto(workoutId);
}

/**
 * GET /api/workouts — история только завершённых тренировок.
 * Фильтры: place — точное совпадение; from/to — даты YYYY-MM-DD в UTC,
 * to включается целиком (startedAt < to + 1 день). Счётчики упражнений и
 * подходов приходят агрегатами репозитория (skipped исключены).
 */
export async function listWorkoutHistory(
  userId: number,
  query: WorkoutListQuery,
): Promise<{ data: WorkoutListItemDto[]; meta: PaginationMeta }> {
  const where: Prisma.WorkoutWhereInput = { userId, status: 'completed' };
  if (query.place !== undefined) {
    where.place = query.place;
  }
  if (query.from !== undefined || query.to !== undefined) {
    const startedAt: Prisma.DateTimeFilter = {};
    if (query.from !== undefined) {
      startedAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    }
    if (query.to !== undefined) {
      startedAt.lt = new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 86_400_000);
    }
    where.startedAt = startedAt;
  }

  const [rows, total] = await workoutRepo.listWorkouts(where, query.page, query.limit);
  return {
    data: rows.map(historyItemToDto),
    meta: { page: query.page, limit: query.limit, total },
  };
}

/**
 * DELETE /api/workouts/:id — удаление завершённой или отменённой тренировки.
 * Результаты и подходы удаляются каскадом (onDelete: Cascade).
 * Предварительная проверка — лёгкая (findWorkoutRevision); гонка удаления
 * между проверкой и DELETE (P2025) преобразуется в тот же 404.
 */
export async function deleteWorkout(userId: number, workoutId: number): Promise<void> {
  const workout = await workoutRepo.findWorkoutRevision(workoutId);
  if (!workout || workout.userId !== userId) {
    throw new AppError('NOT_FOUND', 'Тренировка не найдена');
  }
  if (workout.status === 'in_progress') {
    throw new AppError('CONFLICT', 'Нельзя удалить активную тренировку');
  }
  try {
    await workoutRepo.deleteWorkout(workoutId);
  } catch (err) {
    if (isRecordNotFound(err)) {
      throw new AppError('NOT_FOUND', 'Тренировка не найдена');
    }
    throw err;
  }
}
