import { createHash } from 'node:crypto';
import { Prisma } from './generated/index.js';

/**
 * Канонический сериализатор контрольных сумм Шага 0 — прототип V1
 * из плана миграции этапа 3 (docs/stage0-experiments.md §«Сериализация V1»).
 *
 * Гарантии однозначности:
 * - каждое поле кодируется как <typeTag><len>:<payload> — границы задаются
 *   длиной, поэтому управляющие байты и разделители внутри строк безопасны;
 * - NULL кодируется тегом N без payload и не путается с пустой строкой S0:;
 * - Decimal канонизируется: хвостовые нули дробной части отбрасываются
 *   ("40.50" -> "40.5"), поэтому представление детерминировано;
 * - DateTime — toISOString() (UTC, миллисекунды);
 * - заголовок включает версию сериализатора и число строк — смена формата
 *   инвалидирует старые снимки, а не даёт ложные совпадения.
 */

export type Field =
  | { tag: 'N' } // NULL
  | { tag: 'S'; v: string } // строка «как хранится»
  | { tag: 'I'; v: number | bigint } // целое
  | { tag: 'B'; v: boolean } // boolean
  | { tag: 'D'; v: string | Prisma.Decimal } // Decimal
  | { tag: 'T'; v: Date }; // DateTime

/** Каноническая строка Decimal: без хвостовых нулей дробной части. */
export function canonDecimal(value: string | Prisma.Decimal): string {
  let s = (typeof value === 'string' ? value : value.toString()).trim();
  if (s.includes('.')) {
    s = s.replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
  }
  if (s === '' || s === '-' || s === '-0' || s === '0') s = '0';
  return s;
}

function encodeField(f: Field): Buffer {
  if (f.tag === 'N') return Buffer.from('N0:', 'ascii');
  let payload: string;
  switch (f.tag) {
    case 'S':
      payload = f.v;
      break;
    case 'I':
      payload = f.v.toString();
      break;
    case 'B':
      payload = f.v ? '1' : '0';
      break;
    case 'D':
      payload = canonDecimal(f.v);
      break;
    case 'T':
      payload = f.v.toISOString();
      break;
  }
  const bytes = Buffer.from(payload, 'utf8');
  return Buffer.concat([Buffer.from(`${f.tag}${bytes.length}:`, 'ascii'), bytes]);
}

/**
 * SHA-256 канонической сериализации таблицы.
 * rows — строки в фиксированном порядке колонок, отсортированные по id.
 */
export function tableChecksum(table: string, rows: Field[][]): string {
  const parts: Buffer[] = [Buffer.from(`V1|${table}|${rows.length}|`, 'ascii')];
  for (const row of rows) {
    for (const field of row) parts.push(encodeField(field));
  }
  return createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}
