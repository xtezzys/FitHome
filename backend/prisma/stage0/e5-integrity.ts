import { check, dbUrl, freshDbFile, initSchema, newClient, REBUILD_STATEMENTS, resetChecks, seed, summary } from './helpers.js';

/**
 * E-5 — целостность после rebuild: связи, Restrict/Cascade, уникальность,
 * индексы. Критерии: дети сохранены с прежними ссылками; Restrict работает
 * на пересозданной таблице; Cascade жив; unique (program_id, ord) жив;
 * индексы присутствуют в index_list.
 */

interface PeRow { id: number; program_id: number; exercise_id: number; ord: number; target_weight: number | null }

async function main(): Promise<number> {
  resetChecks();
  console.log('[E-5] Целостность связей и ограничений после rebuild');

  const file = freshDbFile('e5.db');
  const url = dbUrl('e5.db');
  const db = newClient(url);
  try {
    await initSchema(db);
    const seedInfo = await seed(db);
    const before = await db.$queryRawUnsafe<PeRow[]>(
      `SELECT * FROM "probe_program_exercises" ORDER BY "id"`,
    );

    // Rebuild в транзакции (как в E-A, сценарий успеха)
    await db.$transaction(async (tx) => {
      for (const statement of REBUILD_STATEMENTS) {
        await tx.$executeRawUnsafe(statement);
      }
      const fk = await tx.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
      check('E-5: rebuild — foreign_key_check пуст внутри транзакции', Array.isArray(fk) && fk.length === 0);
    });

    // 1. Дети сохранены
    const after = await db.$queryRawUnsafe<PeRow[]>(`SELECT * FROM "probe_program_exercises" ORDER BY "id"`);
    check('E-5: строки probe_program_exercises сохранены с прежними id и ссылками', JSON.stringify(after) === JSON.stringify(before), `${before.length} -> ${after.length}`);

    // 2. Restrict: удаление используемого упражнения отклоняется
    let restrictBlocked = false;
    let restrictMessage = '';
    try {
      await db.$executeRawUnsafe(`DELETE FROM "probe_exercises" WHERE "id" = ?`, seedInfo.exerciseIds[0]);
    } catch (err) {
      restrictBlocked = true;
      restrictMessage = err instanceof Error ? err.message : String(err);
    }
    check('E-5: onDelete Restrict работает после rebuild (удаление используемого упражнения отклонено)', restrictBlocked, restrictMessage.slice(0, 120));

    // 3. Cascade: удаление программы удаляет её состав
    await db.$executeRawUnsafe(`DELETE FROM "probe_programs" WHERE "id" = ?`, seedInfo.readyProgramId);
    const afterCascade = await db.$queryRawUnsafe<PeRow[]>(
      `SELECT * FROM "probe_program_exercises" WHERE "program_id" = ?`, seedInfo.readyProgramId,
    );
    check('E-5: onDelete Cascade работает (состав удалён вместе с программой)', afterCascade.length === 0);

    // 4. Unique (program_id, ord)
    let uniqueBlocked = false;
    let uniqueMessage = '';
    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "probe_program_exercises" ("program_id", "exercise_id", "ord") VALUES (?, ?, 1)`,
        seedInfo.ownProgramId,
        seedInfo.exerciseIds[0],
      );
    } catch (err) {
      uniqueBlocked = true;
      uniqueMessage = err instanceof Error ? err.message : String(err);
    }
    check('E-5: unique (program_id, ord) жив после rebuild (дубль ord отклонён)', uniqueBlocked, uniqueMessage.slice(0, 120));

    // 5. Индексы
    const exIdx = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA index_list("probe_exercises")`);
    check('E-5: индекс probe_exercises_name_lower_idx пересоздан', exIdx.some((i) => i.name === 'probe_exercises_name_lower_idx'), JSON.stringify(exIdx.map((i) => i.name)));
    const peIdx = await db.$queryRawUnsafe<Array<{ name: string; unique: number | bigint }>>(`PRAGMA index_list("probe_program_exercises")`);
    const uniqIdx = peIdx.find((i) => i.name === 'probe_program_exercises_program_id_ord_key');
    check('E-5: unique-индекс (program_id, ord) присутствует и уникален', Number(uniqIdx?.unique ?? 0) === 1, JSON.stringify(peIdx.map((i) => i.name)));

    // 6. foreign_key_check после мутаций
    const fk = await db.$queryRawUnsafe('PRAGMA foreign_key_check');
    check('E-5: foreign_key_check после мутаций — 0 строк', Array.isArray(fk) && fk.length === 0);
  } finally {
    await db.$disconnect();
  }

  return summary('E-5');
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[E-5] ОШИБКА:', err);
    process.exit(1);
  },
);
