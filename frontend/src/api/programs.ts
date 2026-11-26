import { request } from './client.js';
import type { Paginated } from '../types/exercise';
import type {
  IncomingShare,
  IncomingShareDetail,
  OutgoingShare,
  Program,
  ProgramExercise,
  ProgramExerciseInput,
  ProgramInput,
  ProgramShareCreated,
  ProgramUpdateInput,
} from '../types/program';

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

/** PUT /api/programs/:id — изменение своей программы и публикация (isPublic). */
export function updateProgram(id: number, dto: ProgramUpdateInput): Promise<Program> {
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

// ─── Этап 5: публичная библиотека и обмен ───

export interface PublicProgramListParams {
  page?: number;
  limit?: number;
  place?: string;
  search?: string;
}

function buildPublicQuery(params: PublicProgramListParams): string {
  const parts: string[] = [];
  if (params.page !== undefined) parts.push(`page=${params.page}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  if (params.place) parts.push(`place=${params.place}`);
  if (params.search) parts.push(`search=${encodeURIComponent(params.search)}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** GET /api/programs/public — публичная библиотека с поиском и фильтром. */
export function listPublicPrograms(
  params: PublicProgramListParams = {},
): Promise<Paginated<Program>> {
  return request<Paginated<Program>>(`/api/programs/public${buildPublicQuery(params)}`);
}

/** POST /api/programs/:id/share — отправка своей программы по email. */
export function shareProgram(id: number, email: string): Promise<ProgramShareCreated> {
  return request<ProgramShareCreated>(`/api/programs/${id}/share`, {
    method: 'POST',
    body: { email },
  });
}

/** GET /api/programs/shares/incoming — полученные программы. */
export function listIncomingShares(): Promise<{ data: IncomingShare[] }> {
  return request<{ data: IncomingShare[] }>('/api/programs/shares/incoming');
}

/** GET /api/programs/shares/outgoing — отправленные программы. */
export function listOutgoingShares(): Promise<{ data: OutgoingShare[] }> {
  return request<{ data: OutgoingShare[] }>('/api/programs/shares/outgoing');
}

/** GET /api/programs/shares/:shareId — просмотр полученной программы. */
export function getIncomingShare(shareId: number): Promise<IncomingShareDetail> {
  return request<IncomingShareDetail>(`/api/programs/shares/${shareId}`);
}

/** POST /api/programs/shares/:shareId/save — независимая копия в библиотеку. */
export function saveSharedProgram(shareId: number): Promise<Program> {
  return request<Program>(`/api/programs/shares/${shareId}/save`, { method: 'POST' });
}

/** DELETE /api/programs/shares/:shareId — убрать передачу из списка. */
export function deleteIncomingShare(shareId: number): Promise<void> {
  return request<void>(`/api/programs/shares/${shareId}`, { method: 'DELETE' });
}
