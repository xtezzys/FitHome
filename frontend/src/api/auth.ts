import { request } from './client.js';
import type { User } from '../types/user';

/**
 * API-эндпоинты авторизации (docs/api.md §2).
 * Refresh-токен передаётся только через httpOnly cookie —
 * credentials: 'include' выставлен в api/client.ts.
 */

export interface AuthResponse {
  user: User;
  accessToken: string;
}

/** POST /api/auth/register */
export function register(email: string, password: string, name: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: { email, password, name },
    auth: false,
  });
}

/** POST /api/auth/login */
export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

/** POST /api/auth/refresh — по httpOnly cookie, выдаёт новый access-токен. */
export function refresh(): Promise<{ accessToken: string }> {
  return request<{ accessToken: string }>('/api/auth/refresh', { method: 'POST', auth: false });
}

/** POST /api/auth/logout — 204, cookie очищается сервером. */
export function logout(): Promise<void> {
  return request<void>('/api/auth/logout', { method: 'POST', auth: false });
}

/** GET /api/auth/me */
export function getMe(): Promise<User> {
  return request<User>('/api/auth/me');
}

/** PUT /api/auth/me — имя и/или смена пароля. */
export function updateMe(dto: {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
}): Promise<User> {
  return request<User>('/api/auth/me', { method: 'PUT', body: dto });
}
