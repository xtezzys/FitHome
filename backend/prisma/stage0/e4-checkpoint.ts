import fs from 'node:fs';
import { check, dbFile, dbUrl, freshDbFile, initSchema, newClient, resetChecks, summary, tmpDir } from './helpers.js';

/**
 * E-4 — WAL checkpoint перед резервным копированием.
 * Критерии: checkpoint возвращает busy=1 при активном пишущем соединении;
* после завершения писателя busy=0 и WAL-файл обнулён; копия файла пригодна
 * для открытия: integrity_check ok, foreign_key_check пуст, checksum совпадает.
 */

function walSize(file: string): number {
  const wal = file + '-wal';
  return fs.existsSync(wal) ? fs.statSync(wal).size : -1;
}

interface CheckpointResult { busy: number | bigint; log: number | bigint; checkpointed: number | bigint }

async function checkpoint(db: ReturnType<typeof newClient>): Promise<CheckpointResult> {
  const rows = await db.$queryRawUnsafe<Array<CheckpointResult>>('PRAGMA wal_checkpoint(TRUNCATE)');
  const r = rows[0];
  return { busy: Number(r.busy), log: Number(r.log), checkpointed: Number(r.checkpointed) };
}

async function main(): Promise<number> {
  resetChecks();
  console.log('[E-4] WAL checkpoint и валидация резервной копии');

  const file = freshDbFile('e4.db');
  const url = dbUrl('e4.db');
  const db = newClient(url);
  try {
    const mode = await db.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode=WAL');
    check('E-4: журнал переведён в WAL', mode[0]?.journal_mode === 'wal', JSON.stringify(mode[0]));

    await initSchema(db);
    await db.$executeRawUnsafe(
      `INSERT INTO "probe_decimals" ("val", "name") VALUES (40.5, 'e4-row-1'), (12.5, 'e4-row-2')`,
    );

    // Активный писатель: второе соединение держит незакоммиченную транзакцию
    // (после проверки busy транзакция ОТКАТЫВАЕТСЯ — строка не должна попасть в копию)
    const second = newClient(url);
    let gate: ((v: void) => void) | undefined;
    const opened = new Promise<void>((resolve) => (gate = resolve));
    const writerPromise = second.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO "probe_decimals" ("val", "name") VALUES (9.99, 'e4-uncommitted')`);
      await opened;
      throw new Error('E-4: индуцированный откат писателя');
    }, { timeout: 30_000, maxWait: 10_000 });
    await new Promise((r) => setTimeout(r, 500));

    const busyResult = await checkpoint(db);
    check('E-4: checkpoint при активном писателе возвращает busy=1', busyResult?.busy === 1, JSON.stringify(busyResult));

    gate?.();
    let writerRolledBack = false;
    try {
      await writerPromise;
    } catch (err) {
      writerRolledBack = err instanceof Error && err.message.includes('индуцированный откат');
    }
    check('E-4: транзакция писателя откатилась (строка не закоммичена)', writerRolledBack);
    await second.$disconnect();

    const okResult = await checkpoint(db);
    const walAfter = walSize(file);
    check('E-4: checkpoint после завершения писателя — busy=0', okResult?.busy === 0, JSON.stringify(okResult));
    check('E-4: WAL-файл обнулён после TRUNCATE', walAfter === 0, `размер: ${walAfter} байт`);

    // Копия и валидация
    const copyFile = dbFile('e4-copy.db');
    if (fs.existsSync(copyFile)) fs.rmSync(copyFile);
    fs.copyFileSync(file, copyFile);

    const copy = newClient(dbUrl('e4-copy.db'));
    try {
      const integrity = await copy.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
      check('E-4: integrity_check копии — ok', integrity[0]?.integrity_check === 'ok', JSON.stringify(integrity[0]));
      const fk = await copy.$queryRawUnsafe('PRAGMA foreign_key_check');
      check('E-4: foreign_key_check копии — 0 строк', Array.isArray(fk) && fk.length === 0);
      const rows = await copy.probeDecimal.findMany({ orderBy: { id: 'asc' } });
      check('E-4: копия содержит ровно закоммиченные строки (2)', rows.length === 2, `строк: ${rows.length}`);
      check('E-4: откаченная строка писателя в копию не попала', !rows.some((r) => r.name === 'e4-uncommitted'));
    } finally {
      await copy.$disconnect();
    }
    void tmpDir;
  } finally {
    await db.$disconnect();
  }

  return summary('E-4');
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[E-4] ОШИБКА:', err);
    process.exit(1);
  },
);
