/**
 * Каноническая нормализация полей упражнений (этап 3).
 * Инструментальные скрипты (backfill/verify/seed) используют те же правила,
 * что и services: каноническая реализация — src/lib/normalize.ts, здесь реэкспорт.
 */
export {
  canonToken,
  csvFromTokens,
  csvHasToken,
  csvToArray,
  isCanonicalCsv,
  normalizeCsv,
  normalizeName,
} from '../../src/lib/normalize.js';
