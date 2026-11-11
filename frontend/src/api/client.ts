/**
 * HTTP-клиент SPA (docs/architecture.md §4).
 * Единственное место, где делается fetch: подстановка base URL,
 * Bearer-токена из памяти, разбор ошибок docs/api.md §1.
 *
 * Безопасность:
 * - access-токен хранится ТОЛЬКО в памяти модуля — не в localStorage;
 * - refresh-токен ходит в httpOnly cookie (credentials: 'include');
 * - при 401 запрос автоматически повторяется после /api/auth/refresh;
 *   при отказе refresh сессия считается завершённой.
 */

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

let accessToken: string | null = null;

/** Сохраняет access-токен в памяти приложения. */
export function setAccessToken(token: string): void {
  accessToken = token;
}

/** Возвращает текущий access-токен (null — не авторизован). */
export function getAccessToken(): string | null {
  return accessToken;
}

/** Сбрасывает access-токен при выходе или отказе refresh. */
export function clearAccessToken(): void {
  accessToken = null;
}

/** Ошибка API в едином формате docs/api.md §1. */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Требуется ли авторизация (подстановка Bearer и retry после refresh). */
  auth?: boolean;
}

/** Разбирает тело ответа; 204 не имеет тела. */
async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Пытается обновить access-токен по httpOnly refresh-cookie. */
async function tryRefresh(): Promise<boolean> {
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    return false;
  }
  const data = (await response.json()) as { accessToken?: string };
  if (!data.accessToken) {
    return false;
  }
  accessToken = data.accessToken;
  return true;
}

/** Выполняет запрос к API и возвращает разобранный JSON-ответ. */
async function request<T>(path: string, options: RequestOptions = {}, retry = true): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (auth && accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Сеть недоступна. Проверьте подключение', 0);
  }

  if (!response.ok) {
    // Истечение access-токена: прозрачный повтор после refresh (docs/design.md §6.2)
    if (response.status === 401 && auth && retry) {
      clearAccessToken();
      if (await tryRefresh()) {
        return request<T>(path, options, false);
      }
    }
    const data = (await parseBody(response)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      data?.error?.code ?? 'INTERNAL_ERROR',
      data?.error?.message ?? 'Ошибка сервера',
      response.status,
    );
  }

  return (await parseBody(response)) as T;
}

export { request, baseUrl };
