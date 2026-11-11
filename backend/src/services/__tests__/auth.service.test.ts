import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compare } from 'bcryptjs';

// Repositories мокаются целиком: services не зависят от Prisma напрямую
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

import * as userRepository from '../../repositories/user.repository.js';
import * as tokenRepository from '../../repositories/token.repository.js';
import * as authService from '../auth.service.js';
import { AppError } from '../../types/errors.js';

const userRepo = vi.mocked(userRepository);
const tokenRepo = vi.mocked(tokenRepository);

const now = new Date('2026-11-11T10:00:00.000Z');

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    email: 'user@example.com',
    passwordHash: '$2a$10$placeholderhashplaceholderhashplaceholderhashplaceholderhash',
    name: 'Алексей',
    createdAt: now,
    updatedAt: now,
    settings: null,
    programs: [],
    workouts: [],
    refreshTokens: [],
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth.service — register', () => {
  it('создаёт пользователя и настройки одной транзакцией, email в нижнем регистре', async () => {
    const user = makeUser({ email: 'user@example.com' });
    userRepo.createUserWithSession.mockResolvedValue(user as never);

    const result = await authService.register({
      email: '  USER@Example.COM ',
      password: 'password123',
      name: ' Алексей ',
    });

    expect(userRepo.createUserWithSession).toHaveBeenCalledTimes(1);
    const [, refreshArg] = userRepo.createUserWithSession.mock.calls[0];
    expect(userRepo.createUserWithSession.mock.calls[0][0]).toMatchObject({
      email: 'user@example.com',
      name: 'Алексей',
    });
    // Пароль хранится только в виде bcrypt-хеша, а не в открытом виде
    expect(refreshArg).toHaveProperty('tokenHash');
    expect(result.user).toEqual({
      id: 1,
      email: 'user@example.com',
      name: 'Алексей',
      createdAt: now.toISOString(),
    });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('сохранённый хеш совпадает с паролем через bcrypt.compare', async () => {
    userRepo.createUserWithSession.mockImplementation(
      async (data) => makeUser({ passwordHash: data.passwordHash }) as never,
    );
    await authService.register({
      email: 'user@example.com',
      password: 'password123',
      name: 'Алексей',
    });
    const storedHash = userRepo.createUserWithSession.mock.calls[0][0].passwordHash;
    expect(storedHash).not.toBe('password123');
    expect(await compare('password123', storedHash)).toBe(true);
  });

  it('дубликат email (P2002) → CONFLICT', async () => {
    userRepo.createUserWithSession.mockRejectedValue({ code: 'P2002' });
    await expect(
      authService.register({ email: 'user@example.com', password: 'password123', name: 'Алексей' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('auth.service — login', () => {
  it('верные данные → user + accessToken + refresh-токен', async () => {
    const { hash } = await import('bcryptjs');
    const user = makeUser({ passwordHash: await hash('password123', 10) });
    userRepo.findUserByEmail.mockResolvedValue(user as never);

    const result = await authService.login({ email: 'USER@example.com', password: 'password123' });

    expect(userRepo.findUserByEmail).toHaveBeenCalledWith('user@example.com');
    expect(result.user.email).toBe('user@example.com');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('неверный пароль → UNAUTHORIZED, сообщение не раскрывает причину', async () => {
    const { hash } = await import('bcryptjs');
    const user = makeUser({ passwordHash: await hash('password123', 10) });
    userRepo.findUserByEmail.mockResolvedValue(user as never);

    const err = await authService
      .login({ email: 'user@example.com', password: 'wrongpassword' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toBe('Неверный email или пароль');
  });

  it('несуществующий email → тот же UNAUTHORIZED с тем же сообщением', async () => {
    userRepo.findUserByEmail.mockResolvedValue(null);
    await expect(
      authService.login({ email: 'nobody@example.com', password: 'whatever12' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Неверный email или пароль' });
  });

  it('перед входом очищает истёкшие сессии пользователя', async () => {
    const { hash } = await import('bcryptjs');
    const user = makeUser({ passwordHash: await hash('password123', 10) });
    userRepo.findUserByEmail.mockResolvedValue(user as never);
    await authService.login({ email: 'user@example.com', password: 'password123' });
    expect(tokenRepo.deleteStaleSessions).toHaveBeenCalledWith(1);
  });
});

describe('auth.service — refresh (ротация)', () => {
  it('валидный токен → новые access + refresh, старая сессия отозвана', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(makeSession() as never);

    const result = await authService.refresh('valid-refresh-token');

    expect(tokenRepo.rotateSession).toHaveBeenCalledTimes(1);
    const [oldId, next] = tokenRepo.rotateSession.mock.calls[0];
    expect(oldId).toBe(10);
    expect(next.userId).toBe(1);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('отсутствие cookie → UNAUTHORIZED без обращения к БД', async () => {
    await expect(authService.refresh(undefined)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(tokenRepo.findSessionByHash).not.toHaveBeenCalled();
  });

  it('неизвестный токен → UNAUTHORIZED', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(null);
    await expect(authService.refresh('unknown')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('повторное использование отозванного токена → отзыв ВСЕХ сессий пользователя', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(
      makeSession({ revokedAt: new Date(now.getTime() - 1000) }) as never,
    );

    await expect(authService.refresh('replayed-token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(tokenRepo.revokeAllUserSessions).toHaveBeenCalledWith(1);
    expect(tokenRepo.rotateSession).not.toHaveBeenCalled();
  });

  it('истёкший токен → UNAUTHORIZED', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(
      makeSession({ expiresAt: new Date(now.getTime() - 1000) }) as never,
    );
    await expect(authService.refresh('expired-token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(tokenRepo.rotateSession).not.toHaveBeenCalled();
  });
});

describe('auth.service — logout', () => {
  it('отзывает активную сессию по refresh-токену', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(makeSession() as never);
    await authService.logout('valid-token');
    expect(tokenRepo.revokeSession).toHaveBeenCalledWith(10);
  });

  it('без cookie — ничего не делает (идемпотентный выход)', async () => {
    await authService.logout(undefined);
    expect(tokenRepo.findSessionByHash).not.toHaveBeenCalled();
  });

  it('уже отозванная сессия не отзывается повторно', async () => {
    tokenRepo.findSessionByHash.mockResolvedValue(makeSession({ revokedAt: now }) as never);
    await authService.logout('revoked-token');
    expect(tokenRepo.revokeSession).not.toHaveBeenCalled();
  });
});
