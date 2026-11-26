import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAccessToken } from '../client';
import { getExerciseStats, getStatsSummary } from '../stats';

/**
 * Тесты API статистики (docs/api.md §6, этап 4.4):
 * URL, query-параметры from/to/limit и проброс ApiError.
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

function lastCall(): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: String(call[0]), init: call[1] as RequestInit };
}

describe('api/stats — summary', () => {
  it('getStatsSummary: GET /api/stats/summary без параметров', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ workoutsCount: 0 }));

    const result = await getStatsSummary();
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/stats\/summary$/);
    expect(init.method).toBe('GET');
    expect(result.workoutsCount).toBe(0);
  });

  it('getStatsSummary: from/to в query', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ workoutsCount: 0 }));

    await getStatsSummary({ from: '2026-11-01', to: '2026-11-30' });

    expect(lastCall().url).toContain('/api/stats/summary?from=2026-11-01&to=2026-11-30');
  });
});

describe('api/stats — exercise', () => {
  it('getExerciseStats: GET /api/stats/exercises/:id без параметров', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ exerciseId: 10, series: [] }));

    const result = await getExerciseStats(10);
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/stats\/exercises\/10$/);
    expect(init.method).toBe('GET');
    expect(result.exerciseId).toBe(10);
  });

  it('getExerciseStats: from/to/limit в query', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ exerciseId: 10, series: [] }));

    await getExerciseStats(10, { from: '2026-11-01', to: '2026-11-30', limit: 25 });

    expect(lastCall().url).toContain(
      '/api/stats/exercises/10?from=2026-11-01&to=2026-11-30&limit=25',
    );
  });

  it('getExerciseStats: 404 не скрывается', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'NOT_FOUND', message: 'Упражнение не найдено' } }, 404),
    );

    await expect(getExerciseStats(999)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Упражнение не найдено',
    });
  });
});
