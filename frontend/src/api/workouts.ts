import { request } from './client.js';
import type { Paginated } from '../types/exercise';
import type {
  SaveWorkoutResultsInput,
  StartWorkoutInput,
  Workout,
  WorkoutListItem,
  WorkoutListParams,
} from '../types/workout';

/**
 * API-эндпоинты тренировок (docs/api.md §5, этап 4).
 * Авторизация, refresh-retry и разбор ошибок — в api/client.ts.
 * 404/409 не перехватываются: UI сам решает, как обработать отсутствие
 * активной тренировки или устаревшую revision.
 */

function buildQuery(params: WorkoutListParams): string {
  const parts: string[] = [];
  if (params.page !== undefined) parts.push(`page=${params.page}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  if (params.place) parts.push(`place=${params.place}`);
  if (params.from) parts.push(`from=${encodeURIComponent(params.from)}`);
  if (params.to) parts.push(`to=${encodeURIComponent(params.to)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** POST /api/workouts — начало тренировки (программной или свободной). */
export function startWorkout(dto: StartWorkoutInput): Promise<Workout> {
  return request<Workout>('/api/workouts', { method: 'POST', body: dto });
}

/** GET /api/workouts/active — активная тренировка; 404 пробрасывается как ApiError. */
export function getActiveWorkout(): Promise<Workout> {
  return request<Workout>('/api/workouts/active');
}

/** GET /api/workouts — история завершённых тренировок с пагинацией и фильтрами. */
export function listWorkouts(params: WorkoutListParams = {}): Promise<Paginated<WorkoutListItem>> {
  return request<Paginated<WorkoutListItem>>(`/api/workouts${buildQuery(params)}`);
}

/** GET /api/workouts/:id — детали тренировки с результатами и подходами. */
export function getWorkout(id: number): Promise<Workout> {
  return request<Workout>(`/api/workouts/${id}`);
}

/** PUT /api/workouts/:id/results — полная замена результатов; revision для CAS. */
export function saveWorkoutResults(
  id: number,
  dto: SaveWorkoutResultsInput,
): Promise<Workout> {
  return request<Workout>(`/api/workouts/${id}/results`, { method: 'PUT', body: dto });
}

/** PUT /api/workouts/:id — заметки; null очищает. */
export function updateWorkoutNotes(id: number, notes: string | null): Promise<Workout> {
  return request<Workout>(`/api/workouts/${id}`, { method: 'PUT', body: { notes } });
}

/** POST /api/workouts/:id/complete — завершение; revision в body для CAS. */
export function completeWorkout(id: number, revision: number): Promise<Workout> {
  return request<Workout>(`/api/workouts/${id}/complete`, {
    method: 'POST',
    body: { revision },
  });
}

/** POST /api/workouts/:id/cancel — отмена активной тренировки (без body). */
export function cancelWorkout(id: number): Promise<Workout> {
  return request<Workout>(`/api/workouts/${id}/cancel`, { method: 'POST' });
}

/** DELETE /api/workouts/:id — 204; client возвращает undefined. */
export function deleteWorkout(id: number): Promise<void> {
  return request<void>(`/api/workouts/${id}`, { method: 'DELETE' });
}
