import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, clearAccessToken, getAccessToken, request, setAccessToken } from '../client';

/**
 * Тесты HTTP-клиента (docs/testing.md §4, приоритет 1):
 * подстановка Bearer-токена, повтор запроса после refresh,
 * разбор ошибок, отсутствие токена в localStorage.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  clearAccessToken();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api/client — request', () => {
  it('подставляет Bearer-токен из памяти', async () => {
    setAccessToken('token-abc');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await request('/api/auth/me');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer token-abc');
    expect(init.credentials).toBe('include');
  });

  it('access-токен не сохраняется в localStorage/sessionStorage', async () => {
    // Стабы хранилищ: гарантируем, что клиент вообще не обращается к ним
    const storageMock = {
      setItem: vi.fn<(key: string, value: string) => void>(),
      getItem: vi.fn<(key: string) => string | null>(() => null),
      removeItem: vi.fn<(key: string) => void>(),
      clear: vi.fn<() => void>(),
    };
    vi.stubGlobal('localStorage', storageMock);
    vi.stubGlobal('sessionStorage', storageMock);

    setAccessToken('token-abc');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await request('/api/auth/me');

    expect(storageMock.setItem).not.toHaveBeenCalled();
    expect(storageMock.getItem('accessToken')).toBeNull();
  });

  it('401 → refresh → автоматический повтор исходного запроса', async () => {
    fetchMock
      // 1) исходный запрос — 401 (токен истёк)
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Просрочен' } }, 401))
      // 2) /api/auth/refresh — 200 с новым access-токеном
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'token-new' }))
      // 3) повтор исходного запроса — 200
      .mockResolvedValueOnce(jsonResponse({ ok: true, retried: true }));

    const result = await request<{ ok: boolean; retried: boolean }>('/api/auth/me');

    expect(result.retried).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain('/api/auth/refresh');
    expect(getAccessToken()).toBe('token-new');
    // Повтор идёт с новым токеном
    expect(fetchMock.mock.calls[2][1].headers['Authorization']).toBe('Bearer token-new');
  });

  it('401 и отказ refresh → сессия сброшена, ApiError с сообщением сервера', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Просрочен' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Нет cookie' } }, 401));

    await expect(request('/api/auth/me')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Просрочен',
      status: 401,
    });
    expect(getAccessToken()).toBeNull();
  });

  it('разбирает единый формат ошибок docs/api.md §1', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'CONFLICT', message: 'Email занят' } }, 409));

    const err = (await request('/api/auth/register').catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toBe('Email занят');
    expect(err.status).toBe(409);
  });

  it('сетевая ошибка → ApiError NETWORK_ERROR, не выбрасывает сырую ошибку', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(request('/api/auth/me')).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });
});
