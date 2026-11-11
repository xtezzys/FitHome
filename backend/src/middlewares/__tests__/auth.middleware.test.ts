import { describe, expect, it } from 'vitest';
import { requireAuth } from '../auth.middleware.js';
import { signAccessToken } from '../../lib/jwt.js';
import { AppError } from '../../types/errors.js';

/**
 * Unit-тесты middleware аутентификации (docs/testing.md §3.1).
 * Проверяем публичное поведение: 401 без токена / с мусором,
 * req.userId при валидном токене.
 */

function makeReq(authorization?: string) {
  return { headers: { authorization } } as never as import('express').Request;
}

function run(req: import('express').Request) {
  return new Promise<{ err?: unknown; userId?: number }>((resolve) => {
    requireAuth(req, {} as never, (err?: unknown) => {
      resolve({ err, userId: (req as { userId?: number }).userId });
    });
  });
}

describe('auth.middleware — requireAuth', () => {
  it('без заголовка Authorization → UNAUTHORIZED', async () => {
    const { err } = await run(makeReq(undefined));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe('UNAUTHORIZED');
  });

  it('не Bearer-формат → UNAUTHORIZED', async () => {
    const { err } = await run(makeReq('Basic abc'));
    expect((err as AppError).code).toBe('UNAUTHORIZED');
  });

  it('мусорный токен → UNAUTHORIZED', async () => {
    const { err } = await run(makeReq('Bearer not-a-jwt'));
    expect((err as AppError).code).toBe('UNAUTHORIZED');
  });

  it('токен с чужой подписью → UNAUTHORIZED', async () => {
    const jwt = await import('jsonwebtoken');
    const forged = jwt.sign({ type: 'access', sub: '1' }, 'attacker-secret', { expiresIn: 60 });
    const { err } = await run(makeReq(`Bearer ${forged}`));
    expect((err as AppError).code).toBe('UNAUTHORIZED');
  });

  it('валидный access-токен → req.userId установлен, ошибки нет', async () => {
    const token = signAccessToken(42);
    const { err, userId } = await run(makeReq(`Bearer ${token}`));
    expect(err).toBeUndefined();
    expect(userId).toBe(42);
  });
});
