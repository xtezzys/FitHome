import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../repositories/program.repository.js', () => ({
  runTransaction: vi.fn(),
  createProgram: vi.fn(),
  findProgramById: vi.fn(),
  updateProgram: vi.fn(),
  findPublicPrograms: vi.fn(),
  createProgramExercise: vi.fn(),
  findPendingShare: vi.fn(),
  createProgramShare: vi.fn(),
  findProgramShareById: vi.fn(),
  listIncomingShares: vi.fn(),
  listOutgoingShares: vi.fn(),
  updateProgramShareStatus: vi.fn(),
  deleteProgramShare: vi.fn(),
}));

vi.mock('../../repositories/user.repository.js', () => ({
  findUserByEmail: vi.fn(),
}));

import * as programRepo from '../../repositories/program.repository.js';
import * as userRepo from '../../repositories/user.repository.js';
import * as programService from '../program.service.js';

const repo = vi.mocked(programRepo);
const users = vi.mocked(userRepo);
const USER = 1;
const OTHER = 2;
const now = new Date('2026-11-13T10:00:00.000Z');

function makeExercise(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    name: 'Отжимания',
    nameLower: 'отжимания',
    description: null,
    place: 'home',
    metric: 'reps',
    muscleGroups: ',chest,',
    difficulty: 'easy',
    equipment: null,
    userId: null,
    createdAt: now,
    ...overrides,
  };
}

function makePe(exercise = makeExercise(), overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 500,
    programId: 50,
    exerciseId: exercise.id,
    order: 1,
    targetSets: 3,
    targetReps: 10,
    targetWeight: null,
    targetDuration: null,
    restSec: 90,
    exercise,
    ...overrides,
  };
}

function makeProgram(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 50,
    userId: USER,
    name: 'Моя программа',
    description: 'Описание',
    place: 'home',
    isActive: true,
    isPublic: false,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    user: { name: 'Автор' },
    exercises: [],
    _count: { exercises: 0 },
    ...overrides,
  };
}

function makeShare(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    programId: 50,
    fromUserId: OTHER,
    toUserId: USER,
    status: 'pending',
    createdAt: now,
    fromUser: { name: 'Автор' },
    program: makeProgram({ userId: OTHER }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  repo.runTransaction.mockImplementation(async (fn) => fn({} as never));
});

describe('listPublicPrograms', () => {
  it('фильтрует по названию и пагинирует, отдаёт автора', async () => {
    repo.findPublicPrograms.mockResolvedValue([
      makeProgram({ id: 1, name: 'Сила дома', isPublic: true, authorName: 'A' }),
      makeProgram({ id: 2, name: 'Кардио', isPublic: true }),
    ] as never);

    const result = await programService.listPublicPrograms({ page: 1, limit: 10, search: 'сила' });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 1, isPublic: true, authorName: 'Автор' });
    expect(result.meta).toEqual({ page: 1, limit: 10, total: 1 });
    expect(repo.findPublicPrograms).toHaveBeenCalledWith(undefined);
  });

  it('передаёт фильтр места в репозиторий', async () => {
    repo.findPublicPrograms.mockResolvedValue([]);

    await programService.listPublicPrograms({ page: 1, limit: 10, place: 'gym' });

    expect(repo.findPublicPrograms).toHaveBeenCalledWith('gym');
  });
});

describe('updateProgram — публикация', () => {
  it('публикация выставляет publishedAt', async () => {
    repo.findProgramById
      .mockResolvedValueOnce(makeProgram() as never)
      .mockResolvedValueOnce(makeProgram({ isPublic: true, publishedAt: now }) as never);
    repo.updateProgram.mockResolvedValue({} as never);

    const dto = await programService.updateProgram(USER, 50, { isPublic: true });

    expect(repo.updateProgram).toHaveBeenCalledWith(
      50,
      expect.objectContaining({ isPublic: true, publishedAt: expect.any(Date) }),
    );
    expect(dto.isPublic).toBe(true);
  });

  it('снятие с публикации очищает publishedAt', async () => {
    repo.findProgramById
      .mockResolvedValueOnce(makeProgram({ isPublic: true, publishedAt: now }) as never)
      .mockResolvedValueOnce(makeProgram({ isPublic: false, publishedAt: null }) as never);
    repo.updateProgram.mockResolvedValue({} as never);

    await programService.updateProgram(USER, 50, { isPublic: false });

    expect(repo.updateProgram).toHaveBeenCalledWith(
      50,
      expect.objectContaining({ isPublic: false, publishedAt: null }),
    );
  });

  it('чужая программа публиковать нельзя → 403', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram({ userId: OTHER }) as never);

    await expect(programService.updateProgram(USER, 50, { isPublic: true })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(repo.updateProgram).not.toHaveBeenCalled();
  });
});

describe('getProgram / copyProgram — публичные программы', () => {
  it('опубликованная чужая программа доступна для просмотра', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram({ userId: OTHER, isPublic: true }) as never);

    const dto = await programService.getProgram(USER, 50);

    expect(dto.authorName).toBe('Автор');
  });

  it('личная чужая программа недоступна → 403', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram({ userId: OTHER, isPublic: false }) as never);

    await expect(programService.getProgram(USER, 50)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('копия публичной чужой программы создаётся в аккаунте получателя', async () => {
    const source = makeProgram({ userId: OTHER, isPublic: true, exercises: [makePe()] });
    repo.findProgramById
      .mockResolvedValueOnce(source as never)
      .mockResolvedValueOnce(makeProgram({ id: 99, userId: USER }) as never);
    repo.createProgram.mockResolvedValue({ id: 99 } as never);
    repo.createProgramExercise.mockResolvedValue({} as never);

    const copy = await programService.copyProgram(USER, 50);

    expect(repo.createProgram).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, isActive: true }),
      expect.anything(),
    );
    expect(repo.createProgramExercise).toHaveBeenCalledWith(
      expect.objectContaining({ programId: 99, order: 1 }),
      expect.anything(),
    );
    expect(copy.id).toBe(99);
  });
});

describe('shareProgram', () => {
  it('создаёт передачу по email получателя', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram() as never);
    users.findUserByEmail.mockResolvedValue({ id: OTHER, name: 'Друг', email: 'd@example.com' } as never);
    repo.findPendingShare.mockResolvedValue(null);
    repo.createProgramShare.mockResolvedValue({ id: 10, status: 'pending', createdAt: now } as never);

    const dto = await programService.shareProgram(USER, 50, { email: 'd@example.com' });

    expect(repo.createProgramShare).toHaveBeenCalledWith({
      programId: 50,
      fromUserId: USER,
      toUserId: OTHER,
    });
    expect(dto).toMatchObject({ id: 10, programId: 50, toUserName: 'Друг', status: 'pending' });
  });

  it('неизвестный получатель → 404', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram() as never);
    users.findUserByEmail.mockResolvedValue(null);

    await expect(
      programService.shareProgram(USER, 50, { email: 'no@example.com' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('отправка самому себе → 400', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram() as never);
    users.findUserByEmail.mockResolvedValue({ id: USER, name: 'Я' } as never);

    await expect(
      programService.shareProgram(USER, 50, { email: 'me@example.com' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('повторная отправка тому же получателю → 409', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram() as never);
    users.findUserByEmail.mockResolvedValue({ id: OTHER, name: 'Друг' } as never);
    repo.findPendingShare.mockResolvedValue({ id: 10 } as never);

    await expect(
      programService.shareProgram(USER, 50, { email: 'd@example.com' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(repo.createProgramShare).not.toHaveBeenCalled();
  });
});

describe('входящие передачи', () => {
  it('listIncomingShares маппит автора и статус', async () => {
    repo.listIncomingShares.mockResolvedValue([
      { id: 10, programId: 50, program: { name: 'План' }, fromUser: { name: 'Автор' }, status: 'pending', createdAt: now },
    ] as never);

    const rows = await programService.listIncomingShares(USER);

    expect(rows).toEqual([
      { id: 10, programId: 50, programName: 'План', fromUserName: 'Автор', status: 'pending', createdAt: now.toISOString() },
    ]);
  });

  it('getIncomingShare отдаёт программу с составом только получателю', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare() as never);

    const detail = await programService.getIncomingShare(USER, 10);

    expect(detail).toMatchObject({ shareId: 10, fromUserName: 'Автор', status: 'pending' });
    expect(detail.program.id).toBe(50);
  });

  it('чужая передача → 404', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare({ toUserId: OTHER }) as never);

    await expect(programService.getIncomingShare(USER, 10)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('saveSharedProgram', () => {
  it('создаёт независимую копию и помечает передачу saved', async () => {
    const source = makeProgram({ userId: OTHER, exercises: [makePe()] });
    repo.findProgramShareById.mockResolvedValue(makeShare({ program: source }) as never);
    repo.createProgram.mockResolvedValue({ id: 99 } as never);
    repo.createProgramExercise.mockResolvedValue({} as never);
    repo.findProgramById.mockResolvedValue(makeProgram({ id: 99, userId: USER }) as never);
    repo.updateProgramShareStatus.mockResolvedValue({} as never);

    const copy = await programService.saveSharedProgram(USER, 10);

    expect(repo.createProgram).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, name: source.name }),
      expect.anything(),
    );
    expect(repo.updateProgramShareStatus).toHaveBeenCalledWith(10, 'saved');
    expect(copy.id).toBe(99);
  });

  it('недоступное персональное упражнение автора пропускается', async () => {
    const foreign = makePe(makeExercise({ id: 11, userId: OTHER }), { id: 501, order: 2 });
    const source = makeProgram({ userId: OTHER, exercises: [makePe(), foreign] });
    repo.findProgramShareById.mockResolvedValue(makeShare({ program: source }) as never);
    repo.createProgram.mockResolvedValue({ id: 99 } as never);
    repo.createProgramExercise.mockResolvedValue({} as never);
    repo.findProgramById.mockResolvedValue(makeProgram({ id: 99 }) as never);

    await programService.saveSharedProgram(USER, 10);

    expect(repo.createProgramExercise).toHaveBeenCalledTimes(1);
    expect(repo.createProgramExercise).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: 10, order: 1 }),
      expect.anything(),
    );
  });

  it('уже сохранённая передача → 409', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare({ status: 'saved' }) as never);

    await expect(programService.saveSharedProgram(USER, 10)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(repo.createProgram).not.toHaveBeenCalled();
  });

  it('чужая передача → 404', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare({ toUserId: OTHER }) as never);

    await expect(programService.saveSharedProgram(USER, 10)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('deleteIncomingShare', () => {
  it('удаляет передачу получателя', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare() as never);
    repo.deleteProgramShare.mockResolvedValue({} as never);

    await programService.deleteIncomingShare(USER, 10);

    expect(repo.deleteProgramShare).toHaveBeenCalledWith(10);
  });

  it('чужая передача → 404 без удаления', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare({ toUserId: OTHER }) as never);

    await expect(programService.deleteIncomingShare(USER, 10)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(repo.deleteProgramShare).not.toHaveBeenCalled();
  });
});
