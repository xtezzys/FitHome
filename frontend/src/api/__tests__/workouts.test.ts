import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, clearAccessToken } from '../client';
import {
  cancelWorkout,
  completeWorkout,
  deleteWorkout,
  getActiveWorkout,
  getWorkout,
  listWorkouts,
  saveWorkoutResults,
  startWorkout,
  updateWorkoutNotes,
} from '../workouts';

/**
 * Тесты API тренировок (docs/api.md §5, этап 4):
 * URL, HTTP-методы, query-параметры, тела запросов, 204 и проброс ApiError.
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

function bodyOf(init: RequestInit): unknown {
  return JSON.parse(init.body as string) as unknown;
}

describe('api/workouts — старт и активная тренировка', () => {
  it('startWorkout: POST /api/workouts с телом', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7 }));

    const result = await startWorkout({ place: 'home', programId: 50 });
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/workouts$/);
    expect(init.method).toBe('POST');
    expect(bodyOf(init)).toEqual({ place: 'home', programId: 50 });
    expect(result.id).toBe(7);
  });

  it('getActiveWorkout: GET /api/workouts/active', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7, status: 'in_progress' }));

    const result = await getActiveWorkout();
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/workouts\/active$/);
    expect(init.method).toBe('GET');
    expect(result.status).toBe('in_progress');
  });

  it('getActiveWorkout: 404 пробрасывается как ApiError, не null', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'NOT_FOUND', message: 'Активная тренировка не найдена' } },
        404,
      ),
    );

    await expect(getActiveWorkout()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'Активная тренировка не найдена',
    });
  });
});

describe('api/workouts — история и детали', () => {
  it('listWorkouts: query-параметры page/limit/place/from/to', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [], meta: { page: 2, limit: 10, total: 0 } }));

    const result = await listWorkouts({
      page: 2,
      limit: 10,
      place: 'gym',
      from: '2026-11-01',
      to: '2026-11-30',
    });
    const { url } = lastCall();

    expect(url).toContain(
      '/api/workouts?page=2&limit=10&place=gym&from=2026-11-01&to=2026-11-30',
    );
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 0 });
  });

  it('listWorkouts: без параметров не добавляет "?"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [], meta: { page: 1, limit: 20, total: 0 } }));

    await listWorkouts();

    expect(lastCall().url).toMatch(/\/api\/workouts$/);
  });

  it('getWorkout: GET /api/workouts/:id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7 }));

    await getWorkout(7);
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/workouts\/7$/);
    expect(init.method).toBe('GET');
  });
});

describe('api/workouts — автосохранение и заметки', () => {
  it('saveWorkoutResults: PUT /results с revision и results', async () => {
    const dto = {
      revision: 2,
      results: [{ order: 1, exerciseId: 10, sets: [{ order: 1, reps: 10 }] }],
    };
    fetchMock.mockResolvedValue(jsonResponse({ id: 7, revision: 3 }));

    const result = await saveWorkoutResults(7, dto);
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/workouts\/7\/results$/);
    expect(init.method).toBe('PUT');
    expect(bodyOf(init)).toEqual(dto);
    expect(result.revision).toBe(3);
  });

  it('saveWorkoutResults: 409 CONFLICT не скрывается', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'CONFLICT', message: 'Ревизия устарела, актуальная: 5' } },
        409,
      ),
    );

    const err = (await saveWorkoutResults(7, { revision: 2, results: [] }).catch(
      (e) => e,
    )) as ApiError;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('CONFLICT');
    expect(err.status).toBe(409);
    expect(err.message).toContain('актуальная: 5');
  });

  it('updateWorkoutNotes: PUT /:id с { notes }, null сохраняется', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7 }));

    await updateWorkoutNotes(7, 'новые');
    let { url, init } = lastCall();
    expect(url).toMatch(/\/api\/workouts\/7$/);
    expect(init.method).toBe('PUT');
    expect(bodyOf(init)).toEqual({ notes: 'новые' });

    await updateWorkoutNotes(7, null);
    ({ init } = lastCall());
    expect(bodyOf(init)).toEqual({ notes: null });
  });
});

describe('api/workouts — завершение, отмена, удаление', () => {
  it('completeWorkout: POST /complete с revision в body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7, status: 'completed' }));

    const result = await completeWorkout(7, 3);
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/workouts\/7\/complete$/);
    expect(init.method).toBe('POST');
    expect(bodyOf(init)).toEqual({ revision: 3 });
    expect(result.status).toBe('completed');
  });

  it('cancelWorkout: POST /cancel без body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 7, status: 'cancelled' }));

    const result = await cancelWorkout(7);
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/workouts\/7\/cancel$/);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(result.status).toBe('cancelled');
  });

  it('deleteWorkout: DELETE и 204 → undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deleteWorkout(7)).resolves.toBeUndefined();
    const { url, init } = lastCall();

    expect(url).toMatch(/\/api\/workouts\/7$/);
    expect(init.method).toBe('DELETE');
  });
});
