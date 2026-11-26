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

vi.mock('../../repositories/exercise.repository.js', () => ({
  findExerciseById: vi.fn(),
}));

import request from 'supertest';
import { createApp } from '../../app.js';
import * as programRepo from '../../repositories/program.repository.js';
import * as userRepo from '../../repositories/user.repository.js';
import { signAccessToken } from '../../lib/jwt.js';

const repo = vi.mocked(programRepo);
const users = vi.mocked(userRepo);
const app = createApp();
const USER = 1;
const OTHER = 2;
const AUTH = (): [string, string] => ['Authorization', `Bearer ${signAccessToken(USER)}`];
const now = new Date('2026-11-13T10:00:00.000Z');

function makeProgram(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 50,
    userId: USER,
    name: 'Моя программа',
    description: null,
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

describe('Авторизация новых /api/programs endpoints', () => {
  it('401 без токена', async () => {
    for (const action of [
      () => request(app).get('/api/programs/public'),
      () => request(app).get('/api/programs/shares/incoming'),
      () => request(app).get('/api/programs/shares/outgoing'),
      () => request(app).get('/api/programs/shares/10'),
      () => request(app).post('/api/programs/shares/10/save'),
      () => request(app).delete('/api/programs/shares/10'),
      () => request(app).post('/api/programs/50/share').send({ email: 'd@example.com' }),
    ]) {
      const res = await action();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('GET /api/programs/public', () => {
  it('200: публичные программы с автором, фильтр place', async () => {
    repo.findPublicPrograms.mockResolvedValue([
      makeProgram({ id: 50, userId: OTHER, isPublic: true, name: 'Сила' }),
    ] as never);

    const res = await request(app).get('/api/programs/public?place=gym&search=сил').set(...AUTH());

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ name: 'Сила', isPublic: true, authorName: 'Автор' });
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
    expect(repo.findPublicPrograms).toHaveBeenCalledWith('gym');
  });

  it('400: неверное место', async () => {
    const res = await request(app).get('/api/programs/public?place=moon').set(...AUTH());
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/programs/:id — публикация', () => {
  it('200: isPublic=true выставляет publishedAt', async () => {
    repo.findProgramById
      .mockResolvedValueOnce(makeProgram() as never)
      .mockResolvedValueOnce(makeProgram({ isPublic: true, publishedAt: now }) as never);
    repo.updateProgram.mockResolvedValue({} as never);

    const res = await request(app).put('/api/programs/50').set(...AUTH()).send({ isPublic: true });

    expect(res.status).toBe(200);
    expect(res.body.isPublic).toBe(true);
    expect(repo.updateProgram).toHaveBeenCalledWith(
      50,
      expect.objectContaining({ isPublic: true, publishedAt: expect.any(Date) }),
    );
  });

  it('400: isPublic не boolean', async () => {
    const res = await request(app).put('/api/programs/50').set(...AUTH()).send({ isPublic: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/programs/:id — публичная чужая', () => {
  it('200: опубликованная доступна', async () => {
    repo.findProgramById.mockResolvedValue(
      makeProgram({ userId: OTHER, isPublic: true, authorName: 'Автор' }) as never,
    );

    const res = await request(app).get('/api/programs/50').set(...AUTH());
    expect(res.status).toBe(200);
  });

  it('403: личная чужая', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram({ userId: OTHER, isPublic: false }) as never);

    const res = await request(app).get('/api/programs/50').set(...AUTH());
    expect(res.status).toBe(403);
  });
});

describe('POST /api/programs/:id/share', () => {
  it('201: отправка по email', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram() as never);
    users.findUserByEmail.mockResolvedValue({ id: OTHER, name: 'Друг' } as never);
    repo.findPendingShare.mockResolvedValue(null);
    repo.createProgramShare.mockResolvedValue({ id: 10, status: 'pending', createdAt: now } as never);

    const res = await request(app)
      .post('/api/programs/50/share')
      .set(...AUTH())
      .send({ email: 'D@Example.com' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 10, toUserName: 'Друг', status: 'pending' });
    expect(users.findUserByEmail).toHaveBeenCalledWith('d@example.com');
  });

  it('404: получатель не найден', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram() as never);
    users.findUserByEmail.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/programs/50/share')
      .set(...AUTH())
      .send({ email: 'no@example.com' });
    expect(res.status).toBe(404);
  });

  it('409: уже отправлено', async () => {
    repo.findProgramById.mockResolvedValue(makeProgram() as never);
    users.findUserByEmail.mockResolvedValue({ id: OTHER, name: 'Друг' } as never);
    repo.findPendingShare.mockResolvedValue({ id: 10 } as never);

    const res = await request(app)
      .post('/api/programs/50/share')
      .set(...AUTH())
      .send({ email: 'd@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('400: некорректный email', async () => {
    const res = await request(app)
      .post('/api/programs/50/share')
      .set(...AUTH())
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/programs/shares', () => {
  it('200: входящие', async () => {
    repo.listIncomingShares.mockResolvedValue([
      { id: 10, programId: 50, program: { name: 'План' }, fromUser: { name: 'Автор' }, status: 'pending', createdAt: now },
    ] as never);

    const res = await request(app).get('/api/programs/shares/incoming').set(...AUTH());
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ programName: 'План', fromUserName: 'Автор' });
  });

  it('200: просмотр полученной программы', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare() as never);

    const res = await request(app).get('/api/programs/shares/10').set(...AUTH());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shareId: 10, fromUserName: 'Автор' });
  });

  it('404: чужая передача', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare({ toUserId: OTHER }) as never);

    const res = await request(app).get('/api/programs/shares/10').set(...AUTH());
    expect(res.status).toBe(404);
  });
});

describe('POST /api/programs/shares/:shareId/save', () => {
  it('201: независимая копия', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare() as never);
    repo.createProgram.mockResolvedValue({ id: 99 } as never);
    repo.findProgramById.mockResolvedValue(makeProgram({ id: 99, userId: USER }) as never);
    repo.updateProgramShareStatus.mockResolvedValue({} as never);

    const res = await request(app).post('/api/programs/shares/10/save').set(...AUTH());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 99, userId: USER });
    expect(repo.createProgram).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER }),
      expect.anything(),
    );
    expect(repo.updateProgramShareStatus).toHaveBeenCalledWith(10, 'saved');
  });

  it('409: уже сохранено', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare({ status: 'saved' }) as never);

    const res = await request(app).post('/api/programs/shares/10/save').set(...AUTH());
    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/programs/shares/:shareId', () => {
  it('204: получатель убирает передачу', async () => {
    repo.findProgramShareById.mockResolvedValue(makeShare() as never);
    repo.deleteProgramShare.mockResolvedValue({} as never);

    const res = await request(app).delete('/api/programs/shares/10').set(...AUTH());
    expect(res.status).toBe(204);
    expect(repo.deleteProgramShare).toHaveBeenCalledWith(10);
  });
});
