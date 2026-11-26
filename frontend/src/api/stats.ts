import { request } from './client.js';
import type {
  ExerciseStats,
  ExerciseStatsParams,
  StatsSummary,
  StatsSummaryParams,
} from '../types/stats';

/**
 * API-эндпоинты статистики (docs/api.md §6, этап 4.4).
 * Авторизация и разбор ошибок — в api/client.ts; 404 чужого/неизвестного
 * упражнения пробрасывается как ApiError.
 */

function buildQuery(params: { from?: string; to?: string; limit?: number }): string {
  const parts: string[] = [];
  if (params.from) parts.push(`from=${encodeURIComponent(params.from)}`);
  if (params.to) parts.push(`to=${encodeURIComponent(params.to)}`);
  if (params.limit !== undefined) parts.push(`limit=${params.limit}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

/** GET /api/stats/summary — сводка за период (from/to — YYYY-MM-DD UTC). */
export function getStatsSummary(params: StatsSummaryParams = {}): Promise<StatsSummary> {
  return request<StatsSummary>(`/api/stats/summary${buildQuery(params)}`);
}

/** GET /api/stats/exercises/:exerciseId — история упражнения по snapshot-метрикам. */
export function getExerciseStats(
  exerciseId: number,
  params: ExerciseStatsParams = {},
): Promise<ExerciseStats> {
  return request<ExerciseStats>(`/api/stats/exercises/${exerciseId}${buildQuery(params)}`);
}
