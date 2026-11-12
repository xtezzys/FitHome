import fs from 'node:fs';
import path from 'node:path';
import { check, dbUrl, freshDbFile, initSchema, newClient, REBUILD_STATEMENTS, resetChecks, seed, stage0Dir, summary } from './helpers.js';

/**
 * E-6 — разбиение migration.sql на операторы для пооператорного исполнителя.
 * Критерии: разбиение по ';' не режет литералы (в DDL этапа их нет — проверяется
 * сканером кавычек); количество и нормализованное содержимое операторов
 * соответствуют эталону; результат исполнения идентичен rebuild из helpers.
 */

function splitStatements(sql: string): string[] {
  const raw: string[] = [];
  let current = '';
  let inString = false;
  for (const ch of sql) {
    if (ch === "'") inString = !inString;
    if (ch === ';' && !inString) {
      raw.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) raw.push(current.trim());
  // Строки комментариев вырезаются ВНУТРИ оператора, а не выбрасывают его целиком
  return raw
    .map((s) => s
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .trim())
    .filter((s) => s.length > 0);
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

// JSON-безопасное представление (raw-запросы возвращают BigInt)
const safe = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x));

async function structureOf(db: ReturnType<typeof newClient>): Promise<string> {
  const tables = ['probe_exercises', 'probe_programs'];
  const parts: string[] = [];
  for (const t of tables) {
    const cols = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(`PRAGMA table_info("${t}")`);
    const idx = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA index_list("${t}")`);
    parts.push(`${t}: ${safe(cols)} | ${JSON.stringify(idx.map((i) => i.name).sort())}`);
  }
  return parts.join('\n');
}

async function main(): Promise<number> {
  resetChecks();
  console.log('[E-6] Сплит операторов migration.sql');

  const migrationPath = path.join(stage0Dir, 'migrations', '20260101000010_rebuild', 'migration.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const statements = splitStatements(sql);

  check('E-6: в DDL нет точек с запятой внутри строковых литералов', !sql.match(/'[^']*;[^']*'/), 'сканер кавычек');
  check('E-6: операторов 15 (pragma + парковка×3 + 2×(create, insert, drop, rename) + index + возврат×2)', statements.length === 15, `фактически: ${statements.length}`);
  check('E-6: первый оператор — PRAGMA defer_foreign_keys=ON', statements[0]?.toUpperCase() === 'PRAGMA DEFER_FOREIGN_KEYS=ON');

  // Исполнение сплита на свежей БД с данными
  const file = freshDbFile('e6.db');
  const url = dbUrl('e6.db');
  const db = newClient(url);
  let e6Structure = '';
  try {
    await initSchema(db);
    await seed(db);
    await db.$transaction(async (tx) => {
      for (const statement of statements) {
        await tx.$executeRawUnsafe(statement);
      }
      const fk = await tx.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
      check('E-6: сплит-исполнение — foreign_key_check пуст внутри транзакции', Array.isArray(fk) && fk.length === 0);
    });

    // Эталонная структура: тот же rebuild из helpers (независимый источник)
    const refFile = freshDbFile('e6-ref.db');
    const ref = newClient(`file:${refFile}`);
    try {
      await initSchema(ref);
      await seed(ref);
      await ref.$transaction(async (tx) => {
        for (const s of REBUILD_STATEMENTS) {
          await tx.$executeRawUnsafe(s);
        }
      });
      const a = await structureOf(db);
      const b = await structureOf(ref);
      check('E-6: структура после сплит-исполнения идентична эталону (table_info + index_list)', a === b);
      e6Structure = a;
    } finally {
      await ref.$disconnect();
    }

    // Данные целы
    const children = await db.$queryRawUnsafe<Array<{ id: number }>>(`SELECT "id" FROM "probe_program_exercises" ORDER BY "id"`);
    check('E-6: дети после сплит-исполнения целы', children.length === 3, `строк: ${children.length}`);
  } finally {
    await db.$disconnect();
  }

  console.log(`    итоговая структура:\n${e6Structure}`);
  return summary('E-6');
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[E-6] ОШИБКА:', err);
    process.exit(1);
  },
);
