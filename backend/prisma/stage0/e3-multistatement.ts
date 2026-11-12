import { check, dbUrl, freshDbFile, newClient, resetChecks, summary } from './helpers.js';

/**
 * E-3 (информационный) — поддерживает ли $executeRawUnsafe несколько
 * SQL-операторов одной строкой для SQLite на Prisma 6.19.3.
 * Результат фиксируется в docs/stage0-experiments.md; план НЕ полагается
 * на multi-statement (все вызовы пооператорные).
 */

async function main(): Promise<number> {
  resetChecks();
  console.log('[E-3] Multi-statement $executeRawUnsafe (информационный)');

  const file = freshDbFile('e3.db');
  const url = dbUrl('e3.db');
  const db = newClient(url);
  try {
    let multiStatementWorks = false;
    let errorMessage = '';
    try {
      await db.$executeRawUnsafe(
        'CREATE TABLE "e3_a" ("id" INTEGER PRIMARY KEY); CREATE TABLE "e3_b" ("id" INTEGER PRIMARY KEY)',
      );
      multiStatementWorks = true;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const tables = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" LIKE 'e3_%' ORDER BY "name"`,
    );
    const tableNames = tables.map((t) => t.name);

    console.log(`    multi-statement результат: ${multiStatementWorks ? 'РАБОТАЕТ' : 'НЕ РАБОТАЕТ'}`);
    console.log(`    ошибка: ${errorMessage || '(нет)'}`);
    console.log(`    созданные таблицы: ${JSON.stringify(tableNames)}`);
    console.log(`    вывод: план использует пооператорные вызовы $executeRawUnsafe — результат E-3 ни на что не влияет`);

    // Контрольная проверка: пооператорный вызов работает всегда
    await db.$executeRawUnsafe('CREATE TABLE "e3_c" ("id" INTEGER PRIMARY KEY)');
    const after = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT "name" FROM "sqlite_master" WHERE "name" = 'e3_c'`,
    );
    check('E-3: пооператорный $executeRawUnsafe работает (контроль)', after.length === 1);

    void multiStatementWorks;
    void errorMessage;
    void tableNames;
    return summary('E-3');
  } finally {
    await db.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[E-3] ОШИБКА:', err);
    process.exit(1);
  },
);
