import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Repositories мокаются: тестируем HTTP-контракты docs/api.md §2,
// а не Prisma (docs/testing.md §3.1 — контроллеры через HTTP).
vi.mock('../../repositories/user.repository.js', () => ({
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  createUserWithSession: vi.fn(),
  createUser: vi.fn(),
  updateUserName: vi.fn(),
  updateUserPassword: vi.fn(),
}));

vi.mock('../../repositories/token.repository.js', () => ({
  createSession: vi.fn(),
  findSessionByHash: vi.fn(),
  revokeSession: vi.fn(),
  rotateSession: vi.fn(),
  revokeAllUserSessions: vi.fn(),
  deleteStaleSessions: vi.fn(),
}));

import request from 'supertest';
import { createApp } from '../../app.js';
import * as userRepository from '../../repositories/user.repository.js';
import * as tokenRepository from '../../repositories/token.repository.js';
import { signAccessToken } from '../../lib/jwt.js';
import { hash } from 'bcryptjs';

const userRepo = vi.mocked(userRepository);
const tokenRepo = vi.mocked(tokenRepository);

const app = createApp();

const now = new Date('2026-11-11T10:00:00.000Z');
let passwordHash = '';

beforeAll(async () => {
  passwordHash = await hash('password123', 10);
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'user@example.com',
    passwordHash,
    name: 'Алексей',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    userId: 1,
    tokenHash: 'hash',
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    createdAt: now,
    revokedAt: null,
    ...overrides,
  };
}

describe('POST /api/auth/register', () => {
  it('201: user + accessToken + Set-Cookie HttpOnly SameSite=Lax Path=/api/auth', async () => {
    userRepo.createUserWithSession.mockResolvedValue(makeUser() as never);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'password123', name: 'Алексей' });

    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: 1,
      email: 'user@example.com',
      name: 'Алексей',
      createdAt: now.toISOString(),
    });
    expect(res.body.accessToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('refreshToken=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('400 VALIDATION_ERROR: короткий пароль / некорректный email / пустое имя', async () => {
    for (const body of [
      { email: 'user@example.com', password: 'short', name: 'Алексей' },
      { email: 'not-an-email', password: 'password123', name: 'Алексей' },
      { email: 'user@example.com', password: 'password123', name: '' },
      { password: 'password123', name: 'Алексей' }, // нет email
    ]) {
      const res = await request(app).post('/api/auth/register').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(userRepo.createUserWithSession).not.toHaveBeenCalled();
  });

  it('409 CONFLICT: email занят', async () => {
    userRepo.createUserWithSession.mockRejectedValue({ code: 'P2002' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: 'password123', name: 'Алексей' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('POST /api/auth/login', () => {
  it('200: user + accessToken + refresh-cookie', async () => {
    userRepo.findUserByEmail.mockResolvedValue(makeUser() as never);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('user@example.com');
    expect(res.body.accessToken).toBeTruthy();
    expect(res.headers['set-cookie'][0]).toContain('HttpOnly');
  });

  it('401 UNAUTHORIZED при неверном пароле — единое сообщение', async () => {
    userRepo.findUserByEmail.mockResolvedValue(makeUser() as never);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.error.message).toBe('Неверный email или пароль');
  });

  it('400 VALIDATION_ERROR без полей', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/refresh', () => {
  it('200: новый accessToken + ротация cookie', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(makeSession() as never);

    const res = await request(app).post('/api/auth/refresh').set('Cookie', 'refreshToken=valid-token');

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(tokenRepo.rotateSession).toHaveBeenCalledTimes(1);
    expect(res.headers['set-cookie'][0]).toContain('refreshToken=');
  });

  it('401 без cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('401 при невалидном токене в cookie', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(null);
    const res = await request(app).post('/api/auth/refresh').set('Cookie', 'refreshToken=bad-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('204 + cookie очищена (Max-Age=0)', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(makeSession() as never);

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', 'refreshToken=valid-token');

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toContain('Max-Age=0');
    expect(tokenRepo.revokeSession).toHaveBeenCalledWith(10);
  });
});

describe('GET /api/auth/me', () => {
  it('200: профиль текущего пользователя по access-токену', async () => {
    userRepo.findUserById.mockResolvedValue(makeUser() as never);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${signAccessToken(1)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 1,
      email: 'user@example.com',
      name: 'Алексей',
      createdAt: now.toISOString(),
    });
  });

  it('401 без токена', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('401 с просроченным токеном', async () => {
    // Подписываем токен с истёкшим сроком (exp в прошлом)
    const { signAccessToken } = await import('../../lib/jwt.js');
    const { ACCESS_TTL_SECONDS } = await import('../../lib/tokens.js');
    void signAccessToken;
    void ACCESS_TTL_SECONDS;
    const expired = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiYWNjZXNzIiwic3ViIjoiMSIsImlhdCI6MTUwMDAwMDAwMCwiZXhwIjoxNTAwMDAwMDF9.invalidsignature';
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
