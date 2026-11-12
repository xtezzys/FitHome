import { request } from './client.js';
import type { Paginated } from '../types/exercise';
import type { Program, ProgramExercise, ProgramExerciseInput, ProgramInput } from '../types/program';

/**
 * API-эндпоинты программ (docs/api.md §4).
 * Авторизация — через существующий api/client.ts.
 */

export interface ProgramListParams {
  page?: number;
  limit?: number;
  scope?: 'mine' | 'ready';
  place?: string;
}

function buildQuery(params: ProgramListParams): string {
  const parts: string[] = [];
  if (params.page !== undefined) parts.push(`page=${params.page}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  if (params.scope) parts.push(`scope=${params.scope}`);
  if (params.place) parts.push(`place=${params.place}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** GET /api/programs — свои (scope=mine) или готовые (scope=ready). */
export function listPrograms(params: ProgramListParams = {}): Promise<Paginated<Program>> {
  return request<Paginated<Program>>(`/api/programs${buildQuery(params)}`);
}

/** GET /api/programs/:id — программа с составом. */
export function getProgram(id: number): Promise<Program> {
  return request<Program>(`/api/programs/${id}`);
}

/** POST /api/programs — создание своей программы. */
export function createProgram(dto: ProgramInput): Promise<Program> {
  return request<Program>('/api/programs', { method: 'POST', body: dto });
}

/** PUT /api/programs/:id — изменение своей программы. */
export function updateProgram(id: number, dto: Partial<ProgramInput>): Promise<Program> {
  return request<Program>(`/api/programs/${id}`, { method: 'PUT', body: dto });
}

/** DELETE /api/programs/:id — soft delete (204). */
export function deleteProgram(id: number): Promise<void> {
  return request<void>(`/api/programs/${id}`, { method: 'DELETE' });
}

/** POST /api/programs/:id/copy — клонирование готовой/своей программы в аккаунт. */
export function copyProgram(id: number): Promise<Program> {
  return request<Program>(`/api/programs/${id}/copy`, { method: 'POST' });
}

/** POST /api/programs/:id/exercises — добавление упражнения (order = в конец). */
export function addProgramExercise(programId: number, dto: ProgramExerciseInput): Promise<ProgramExercise> {
  return request<ProgramExercise>(`/api/programs/${programId}/exercises`, { method: 'POST', body: dto });
}

/** PUT /api/programs/:id/exercises/:peId — изменение целей упражнения. */
export function updateProgramExercise(
  programId: number,
  programExerciseId: number,
  dto: ProgramExerciseInput,
): Promise<ProgramExercise> {
  return request<ProgramExercise>(
    `/api/programs/${programId}/exercises/${programExerciseId}`,
    { method: 'PUT', body: dto },
  );
}

/** PUT /api/programs/:id/exercises/order — пакетная перестановка порядка. */
export function reorderProgramExercises(
  programId: number,
  orders: Array<{ programExerciseId: number; order: number }>,
): Promise<Program> {
  return request<Program>(`/api/programs/${programId}/exercises/order`, {
    method: 'PUT',
    body: { orders },
  });
}

/** DELETE /api/programs/:id/exercises/:peId — удаление (порядок нормализуется сервером). */
export function removeProgramExercise(programId: number, programExerciseId: number): Promise<void> {
  return request<void>(`/api/programs/${programId}/exercises/${programExerciseId}`, { method: 'DELETE' });
}
