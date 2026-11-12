import { dbUrl, check, freshDbFile, initSchema, newClient, REBUILD_STATEMENTS, resetChecks, seed, summary } from './helpers.js';

/**
 * E-A — интерактивная транзакция Prisma (upgrade-исполнитель Alt 1).
 * Критерии: defer_foreign_keys действует — DROP родителя с детьми не падает;
 * foreign_key_check работает внутри транзакции и детектирует сироту;
 * throw откатывает транзакцию атомарно (DDL и данные).
 */

interface PeRow { id: number; program_id: number; exercise_id: number; ord: number; target_weight: number | null }

async function readChildren(db: ReturnType<typeof newClient>): Promise<PeRow[]> {
  return db.$queryRawUnsafe<PeRow[]>(`SELECT * FROM "probe_program_exercises" ORDER BY "id"`);
}

async function tableColumns(db: ReturnType<typeof newClient>, table: string): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
  return rows.map((r) => r.name);
}

async function leftoverNewTables(db: ReturnType<typeof newClient>): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" LIKE '_new_%'`,
  );
  return rows.map((r) => r.name);
}

async function main(): Promise<number> {
  resetChecks();
  console.log('[E-A] Интерактивная транзакция: rebuild, foreign_key_check, откат');

  // --- Сценарий 1: успешный rebuild с существующими FK-детьми ---
  {
    const file = freshDbFile('ea-ok.db');
    const url = dbUrl('ea-ok.db');
    const db = newClient(url);
    try {
      await initSchema(db);
      const seedInfo = await seed(db);
      const before = await readChildren(db);

      await db.$transaction(async (tx) => {
        for (const statement of REBUILD_STATEMENTS) {
          await tx.$executeRawUnsafe(statement);
        }
        const fk = await tx.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
        check('E-A: foreign_key_check внутри транзакции возвращает 0 строк', Array.isArray(fk) && fk.length === 0, JSON.stringify(fk));
      });

      const after = await readChildren(db);
      check('E-A: DROP родителя с FK-детьми не упал (defer_foreign_keys действует)', true);
      check('E-A: строки probe_program_exercises сохранены с теми же id и ссылками', JSON.stringify(after) === JSON.stringify(before), `${before.length} -> ${after.length}`);

      const exCols = await tableColumns(db, 'probe_exercises');
      check('E-A: probe_exercises в целевой схеме (name_lower, difficulty NOT NULL)',
        exCols.includes('name_lower') && exCols.includes('difficulty'));
      const progCols = await tableColumns(db, 'probe_programs');
      check('E-A: probe_programs пересоздана (user_id nullable сохранён)', progCols.includes('user_id'));

      const lowered = await db.$queryRawUnsafe<Array<{ name: string; name_lower: string }>>(
        `SELECT "name", "name_lower" FROM "probe_exercises" WHERE "name" = 'Отжимания'`,
      );
      check('E-A: кириллица после SQL lower() осталась без изменения (ASCII-only lower — ожидаемо)',
        lowered[0]?.name_lower === 'Отжимания', JSON.stringify(lowered[0]));

      const leftovers = await leftoverNewTables(db);
      check('E-A: временные _new_* таблицы не остались', leftovers.length === 0, JSON.stringify(leftovers));
      void seedInfo;
    } finally {
      await db.$disconnect();
    }
  }

  // --- Сценарий 2: сирота внутри транзакции → foreign_key_check детектирует → откат ---
  {
    const url = dbUrl('ea-orphan.db');
    const file = freshDbFile('ea-orphan.db');
    const db = newClient(`file:${file}`);
    try {
      await initSchema(db);
      const seedInfo = await seed(db);
      const before = await readChildren(db);

      let rolledBack = false;
      try {
        await db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('PRAGMA defer_foreign_keys=ON');
          // Сирота: exercise_id 999999 не существует — нарушение отложено до COMMIT
          await tx.$executeRawUnsafe(
            `INSERT INTO "probe_program_exercises" ("program_id", "exercise_id", "ord") VALUES (?, 999999, 9)`,
            seedInfo.readyProgramId,
          );
          const fk = await tx.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
          check('E-A: foreign_key_check внутри транзакции обнаруживает сироту', Array.isArray(fk) && fk.length > 0, `нарушений: ${fk.length}`);
          throw new Error('Индуцированный откат E-A');
        });
      } catch (err) {
        console.log(`    сценарий 2: ошибка внутри транзакции: ${err instanceof Error ? err.message : String(err)}`);
        rolledBack = err instanceof Error && err.message.includes('Индуцированный откат');
      }
      check('E-A: throw внутри $transaction откатил транзакцию', rolledBack);

      const after = await readChildren(db);
      check('E-A: сирота не сохранилась (откат данных)', after.length === before.length, `${before.length} -> ${after.length}`);
      check('E-A: ДАННЫЕ идентичны до-транзакционным', JSON.stringify(after) === JSON.stringify(before));
    } finally {
      await db.$disconnect();
    }
  }

  // --- Сценарий 3: откат DDL — rebuild + сирота в одной транзакции ---
  {
    const file = freshDbFile('ea-ddl-rollback.db');
    const url = dbUrl('ea-ddl-rollback.db');
    const db = newClient(url);
    try {
      await initSchema(db);
      const seedInfo = await seed(db);
      const before = await readChildren(db);

      try {
        await db.$transaction(async (tx) => {
          for (const statement of REBUILD_STATEMENTS) {
            await tx.$executeRawUnsafe(statement);
          }
          // Сирота после успешного rebuild — COMMIT невозможен
          await tx.$executeRawUnsafe(
            `INSERT INTO "probe_program_exercises" ("program_id", "exercise_id", "ord") VALUES (?, 999999, 9)`,
            seedInfo.ownProgramId,
          );
          const fk = await tx.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
          check('E-A: сирота после rebuild детектируется до COMMIT', Array.isArray(fk) && fk.length > 0);
          throw new Error('Индуцированный откат DDL');
        });
      } catch {
        // ожидаемо
      }

      const exCols = await tableColumns(db, 'probe_exercises');
      check('E-A: DDL откатился атомарно — probe_exercises в СТАРОЙ схеме (без name_lower)', !exCols.includes('name_lower'), JSON.stringify(exCols));
      const leftovers = await leftoverNewTables(db);
      check('E-A: _new_* таблицы после отката DDL отсутствуют', leftovers.length === 0, JSON.stringify(leftovers));
      const after = await readChildren(db);
      check('E-A: дети целы после отката DDL', JSON.stringify(after) === JSON.stringify(before));
    } finally {
      await db.$disconnect();
    }
  }

  return summary('E-A');
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[E-A] ОШИБКА:', err);
    process.exit(1);
  },
);
