import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/exercise.repository.js', () => ({
  listExercises: vi.fn(),
  findExerciseById: vi.fn(),
  findPersonalByNameLower: vi.fn(),
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  deleteExercise: vi.fn(),
}));

vi.mock('../../repositories/program.repository.js', () => ({
  runTransaction: vi.fn(),
  listPrograms: vi.fn(),
  findProgramById: vi.fn(),
  createProgram: vi.fn(),
  updateProgram: vi.fn(),
  softDeleteProgram: vi.fn(),
  findProgramExerciseById: vi.fn(),
  findProgramExerciseByOrder: vi.fn(),
  listProgramExercises: vi.fn(),
  findMaxProgramExerciseOrder: vi.fn(),
  createProgramExercise: vi.fn(),
  updateProgramExercise: vi.fn(),
  deleteProgramExercise: vi.fn(),
  updateProgramExerciseOrder: vi.fn(),
}));

import * as programRepo from '../../repositories/program.repository.js';
import * as exerciseRepo from '../../repositories/exercise.repository.js';
import * as programService from '../program.service.js';

const repo = vi.mocked(programRepo);
const exRepo = vi.mocked(exerciseRepo);

const now = new Date('2026-11-11T10:00:00.000Z');
const USER = 1;
const OTHER = 2;

function makeExercise(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    name: 'Отжимания',
    nameLower: 'отжимания',
    description: null,
    place: 'home',
    metric: 'reps',
    muscleGroups: ',chest,triceps,',
    difficulty: 'easy',
    equipment: null,
    userId: null,
    createdAt: now,
    ...overrides,
  };
}

function makePe(exercise: ReturnType<typeof makeExercise>, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 500,
    programId: 50,
    exerciseId: exercise.id,
    order: 1,
    targetSets: 3,
    targetReps: 15,
    targetWeight: null,
    targetDuration: null,
    exercise,
    ...overrides,
  };
}

function makeProgram(
  exercises: ReturnType<typeof makePe>[],
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: 50,
    userId: USER,
    name: 'Моя программа',
    description: null,
    place: 'home',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    exercises,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // runTransaction выполняет колбэк с tx-заглушкой
  repo.runTransaction.mockImplementation((fn) => fn({} as never));
});

describe('program.service — listPrograms', () => {
  it('scope=mine: where по userId текущего пользователя', async () => {
    repo.listPrograms.mockResolvedValue([[], 0]);
    await programService.listPrograms(USER, { page: 1, limit: 20, scope: 'mine' });
    const [where] = repo.listPrograms.mock.calls[0];
    expect(where).toMatchObject({ userId: USER });
  });

  it('scope=mine: фильтр isActive передаётся', async () => {
    repo.listPrograms.mockResolvedValue([[], 0]);
    await programService.listPrograms(USER, { page: 1, limit: 20, scope: 'mine', isActive: false });
    const [where] = repo.listPrograms.mock.calls[0];
    expect(where).toMatchObject({ userId: USER, isActive: false });
  });

  it('scope=ready: только готовые активные программы (userId = null)', async () => {
    repo.listPrograms.mockResolvedValue([[], 0]);
    await programService.listPrograms(USER, { page: 1, limit: 20, scope: 'ready' });
    const [where] = repo.listPrograms.mock.calls[0];
    expect(where).toMatchObject({ userId: null, isActive: true });
  });
});

describe('program.service — getProgram', () => {
  it('готовая программа доступна для чтения любому', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: null }) as never);
    const dto = await programService.getProgram(USER, 50);
    expect(dto.exercises).toEqual([]);
    expect(dto.userId).toBeNull();
  });

  it('чужая персональная → 403', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: OTHER }) as never);
    await expect(programService.getProgram(USER, 50)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('несуществующая → 404', async () => {
    repo.findProgramById.mockResolvedValue(null);
    await expect(programService.getProgram(USER, 50)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('program.service — мутации программ', () => {
  it('updateProgram: готовая → 403 (read-only)', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: null }) as never);
    await expect(programService.updateProgram(USER, 50, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('updateProgram: чужая → 403', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: OTHER }) as never);
    await expect(programService.updateProgram(USER, 50, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('deleteProgram: soft delete isActive=false', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: USER }) as never);
    repo.softDeleteProgram.mockResolvedValue(makeProgram([], { isActive: false }) as never);
    await programService.deleteProgram(USER, 50);
    expect(repo.softDeleteProgram).toHaveBeenCalledWith(50);
  });
});

describe('program.service — copyProgram', () => {
  const shared = makeExercise();
  const own = makeExercise({ id: 101, userId: USER, name: 'Моё' });

  it('копирует готовую программу: новая программа + состав с теми же order/целями', async () => {
    const source = makeProgram([makePe(shared)], { userId: null, id: 60, name: 'Готовая' });
    repo.findProgramById.mockResolvedValueOnce(source as never).mockResolvedValueOnce(
      makeProgram([makePe(shared)], { id: 99, userId: USER, name: 'Готовая' }) as never,
    );
    repo.createProgram.mockResolvedValue({ id: 99, userId: USER, name: 'Готовая', description: null, place: 'home', isActive: true, createdAt: now, updatedAt: now } as never);
    repo.createProgramExercise.mockResolvedValue(makePe(shared, { programId: 99 }) as never);

    const dto = await programService.copyProgram(USER, 60);
    expect(repo.createProgram).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, name: 'Готовая' }),
      expect.anything(),
    );
    expect(repo.createProgramExercise).toHaveBeenCalledWith(
      expect.objectContaining({ programId: 99, exerciseId: shared.id, order: 1 }),
      expect.anything(),
    );
    expect(dto.id).toBe(99);
  });

  it('источник с чужим персональным упражнением → 403, транзакция откатывается', async () => {
    const foreign = makeExercise({ id: 102, userId: OTHER, name: 'Чужое' });
    const source = makeProgram([makePe(foreign)], { userId: OTHER, id: 60 });
    repo.findProgramById.mockResolvedValue(source as never);

    await expect(programService.copyProgram(USER, 60)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Транзакция не создаёт частичную копию: createProgram внутри колбэка не вызывался
    expect(repo.createProgram).not.toHaveBeenCalled();
  });

  it('источник — чужая персональная программа → 403', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: OTHER }) as never);
    await expect(programService.copyProgram(USER, 60)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('program.service — addProgramExercise', () => {
  const shared = makeExercise();
  const program = makeProgram([makePe(shared)], { id: 50, userId: USER });

  it('добавляет в конец: order = max + 1', async () => {
    repo.findProgramById.mockResolvedValue(program as never);
    exRepo.findExerciseById.mockResolvedValue(shared as never);
    repo.findMaxProgramExerciseOrder.mockResolvedValue(1);
    repo.findProgramExerciseByOrder.mockResolvedValue(null);
    repo.createProgramExercise.mockResolvedValue(makePe(shared, { programId: 50, order: 2 }) as never);

    const dto = await programService.addProgramExercise(USER, 50, { exerciseId: shared.id, targetSets: 3, targetReps: 10 });
    expect(repo.createProgramExercise).toHaveBeenCalledWith(
      expect.objectContaining({ programId: 50, exerciseId: shared.id, order: 2 }),
    );
    expect(dto.order).toBe(2);
  });

  it('занятая позиция order → 400', async () => {
    repo.findProgramById.mockResolvedValue(program as never);
    exRepo.findExerciseById.mockResolvedValue(shared as never);
    repo.findMaxProgramExerciseOrder.mockResolvedValue(1);
    repo.findProgramExerciseByOrder.mockResolvedValue(makePe(shared) as never);

    await expect(
      programService.addProgramExercise(USER, 50, { exerciseId: shared.id, targetSets: 3, targetReps: 10, order: 1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('чужое персональное упражнение → 403', async () => {
    repo.findProgramById.mockResolvedValue(program as never);
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ id: 102, userId: OTHER }) as never);

    await expect(
      programService.addProgramExercise(USER, 50, { exerciseId: 102, targetSets: 3, targetReps: 10 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('цели не соответствуют метрике reps (targetWeight задан) → 400', async () => {
    repo.findProgramById.mockResolvedValue(program as never);
    exRepo.findExerciseById.mockResolvedValue(shared as never);

    await expect(
      programService.addProgramExercise(USER, 50, { exerciseId: shared.id, targetSets: 3, targetReps: 10, targetWeight: 40 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('метрика reps_weight требует targetReps и targetWeight', async () => {
    repo.findProgramById.mockResolvedValue(program as never);
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ metric: 'reps_weight' }) as never);

    await expect(
      programService.addProgramExercise(USER, 50, { exerciseId: 100, targetSets: 3, targetReps: 10 }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('метрика time требует targetDuration', async () => {
    repo.findProgramById.mockResolvedValue(program as never);
    exRepo.findExerciseById.mockResolvedValue(makeExercise({ metric: 'time' }) as never);
    repo.findMaxProgramExerciseOrder.mockResolvedValue(1);
    repo.findProgramExerciseByOrder.mockResolvedValue(null);
    repo.createProgramExercise.mockResolvedValue(
      makePe(makeExercise({ metric: 'time' }), { targetReps: null, targetDuration: 40 }) as never,
    );

    await expect(
      programService.addProgramExercise(USER, 50, { exerciseId: 100, targetSets: 3, targetDuration: 40 }),
    ).resolves.toBeTruthy();
  });
});

describe('program.service — reorderProgramExercises', () => {
  const ex1 = makeExercise({ id: 100 });
  const ex2 = makeExercise({ id: 101 });
  const rows = [makePe(ex1, { id: 501, order: 1 }), makePe(ex2, { id: 502, order: 2 })];
  const program = makeProgram(rows, { id: 50, userId: USER });

  function setupRepo(): void {
    repo.findProgramById.mockResolvedValue(program as never);
    repo.updateProgramExerciseOrder.mockResolvedValue({} as never);
  }

  it('валидная перестановка: двухфазное обновление (отрицательные → финальные)', async () => {
    setupRepo();
    repo.listProgramExercises.mockResolvedValue(rows);
    repo.findProgramById.mockResolvedValue(program as never);

    await programService.reorderProgramExercises(USER, 50, {
      orders: [{ programExerciseId: 502, order: 1 }, { programExerciseId: 501, order: 2 }],
    });

    const calls = repo.updateProgramExerciseOrder.mock.calls;
    // Фаза 1: отрицательные значения для всех строк
    expect(calls.slice(0, 2).map((c) => c[1])).toEqual([-1, -2]);
    // Фаза 2: финальные позиции
    expect(calls.slice(2).map((c) => c[1])).toEqual([1, 2]);
  });

  it('неполный набор ids → 400', async () => {
    setupRepo();
    await expect(
      programService.reorderProgramExercises(USER, 50, { orders: [{ programExerciseId: 501, order: 1 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('дубликат позиции → 400', async () => {
    setupRepo();
    await expect(
      programService.reorderProgramExercises(USER, 50, {
        orders: [{ programExerciseId: 501, order: 1 }, { programExerciseId: 502, order: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('чужая программа → 403', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram(rows, { userId: OTHER }) as never);
    await expect(
      programService.reorderProgramExercises(USER, 50, {
        orders: [{ programExerciseId: 501, order: 1 }, { programExerciseId: 502, order: 2 }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('program.service — removeProgramExercise', () => {
  it('удаляет и нормализует порядок оставшихся (3 → 2)', async () => {
    const ex = makeExercise();
    const rows = [
      makePe(ex, { id: 501, order: 1 }),
      makePe(ex, { id: 502, order: 2 }),
      makePe(ex, { id: 503, order: 3 }),
    ];
    repo.findProgramById.mockResolvedValue(makeProgram(rows, { userId: USER }) as never);
    repo.findProgramExerciseById.mockResolvedValue(rows[1] as never);
    repo.deleteProgramExercise.mockResolvedValue(rows[1] as never);
    repo.listProgramExercises.mockResolvedValue([rows[0], rows[2]]);
    repo.updateProgramExerciseOrder.mockResolvedValue({} as never);

    await programService.removeProgramExercise(USER, 50, 502);

    expect(repo.deleteProgramExercise).toHaveBeenCalledWith(502, expect.anything());
    expect(repo.updateProgramExerciseOrder).toHaveBeenCalledWith(503, 2, expect.anything());
    expect(repo.updateProgramExerciseOrder).not.toHaveBeenCalledWith(501, 1, expect.anything());
  });

  it('строка состава из другой программы → 404', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram([], { userId: USER }) as never);
    repo.findProgramExerciseById.mockResolvedValue(makePe(makeExercise(), { programId: 999 }) as never);

    await expect(programService.removeProgramExercise(USER, 50, 500)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
