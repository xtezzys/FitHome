/**
 * Каноническая нормализация полей упражнений (этап 3).
 * Единственный источник правил для services (фильтры/поиск), валидаторов
 * и инструментальных скриптов (prisma/backfill-stage3.ts, prisma/seed.ts —
 * через реэкспорт prisma/stage3/normalize.ts).
 *
 * Формат CSV с ограничивающими запятыми: ",chest,triceps," — фильтры API
 * проверяют точное совпадение целого токена через contains ",<token>,",
 * substring-совпадение исключено (",bench," не совпадёт с "bench_press").
 */

/** Название в нижнем регистре для поиска. JS toLowerCase корректен для кириллицы —
 *  SQL lower() в SQLite обрабатывает только ASCII (docs/stage0-experiments.md). */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Пробелы внутри токена заменяются на подчёркивание ("resistance band" → "resistance_band"). */
export function canonToken(token: string): string {
  return token.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * CSV → канонический формат: trim, lowercase, удаление пустых токенов и
 * дубликатов (первое вхождение сохраняется), сборка с ограничивающими запятыми.
 * Неизвестные (вне словаря) токены СОХРАНЯЮТСЯ. Пустой результат → null.
 */
export function normalizeCsv(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of value.split(',')) {
    const token = canonToken(raw);
    if (token.length === 0 || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens.length > 0 ? `,${tokens.join(',')},` : null;
}

/** Массив уже валидированных токенов → канонический CSV. */
export function csvFromTokens(tokens: string[]): string {
  return `,${tokens.join(',')},`;
}

/** Канонический CSV → массив токенов (без ограничивающих запятых). */
export function csvToArray(canonicalCsv: string | null | undefined): string[] {
  if (!canonicalCsv) return [];
  return canonicalCsv.replace(/^,/, '').replace(/,$/, '').split(',').filter((t) => t.length > 0);
}

/** Точное совпадение целого токена в каноническом CSV. */
export function csvHasToken(canonicalCsv: string | null | undefined, token: string): boolean {
  if (!canonicalCsv) return false;
  return canonicalCsv.includes(`,${canonToken(token)},`);
}

/** Проверка, что значение в каноническом CSV-формате (или null). */
export function isCanonicalCsv(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (!value.startsWith(',') || !value.endsWith(',')) return false;
  const body = value.slice(1, -1);
  if (body.length === 0) return false;
  return body.split(',').every((t) => t.length > 0 && t === canonToken(t));
}
