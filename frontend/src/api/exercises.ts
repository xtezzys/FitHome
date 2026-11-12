import { request } from './client.js';
import type { Exercise, ExerciseInput, ExerciseListParams, Paginated } from '../types/exercise';

/**
 * API-эндпоинты каталога упражнений (docs/api.md §3).
 * Авторизация — через существующий api/client.ts (Bearer + refresh-retry).
 */

function buildQuery(params: ExerciseListParams): string {
  const parts: string[] = [];
  if (params.page !== undefined) parts.push(`page=${params.page}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  if (params.scope && params.scope !== 'all') parts.push(`scope=${params.scope}`);
  if (params.place) parts.push(`place=${params.place}`);
  if (params.metric) parts.push(`metric=${params.metric}`);
  if (params.difficulty) parts.push(`difficulty=${params.difficulty}`);
  if (params.muscle?.length) parts.push(`muscle=${params.muscle.join(',')}`);
  if (params.equipment?.length) parts.push(`equipment=${params.equipment.join(',')}`);
  if (params.search) parts.push(`search=${encodeURIComponent(params.search)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** GET /api/exercises — список с фильтрами, поиском и пагинацией. */
export function listExercises(params: ExerciseListParams = {}): Promise<Paginated<Exercise>> {
  return request<Paginated<Exercise>>(`/api/exercises${buildQuery(params)}`);
}

/** GET /api/exercises/:id */
export function getExercise(id: number): Promise<Exercise> {
  return request<Exercise>(`/api/exercises/${id}`);
}

/** POST /api/exercises — создание персонального упражнения. */
export function createExercise(dto: ExerciseInput): Promise<Exercise> {
  return request<Exercise>('/api/exercises', { method: 'POST', body: dto });
}

/** PUT /api/exercises/:id — изменение своего упражнения. */
export function updateExercise(id: number, dto: Partial<ExerciseInput>): Promise<Exercise> {
  return request<Exercise>(`/api/exercises/${id}`, { method: 'PUT', body: dto });
}

/** DELETE /api/exercises/:id — 204; 409, если упражнение используется. */
export function deleteExercise(id: number): Promise<void> {
  return request<void>(`/api/exercises/${id}`, { method: 'DELETE' });
}
