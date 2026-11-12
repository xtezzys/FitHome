import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Prisma } from './generated/index.js';
import { tableChecksum, type Field } from './checksum.js';
import {
  backendDir, check, dbFile, freshDbFile, initSchema, newClient, resetChecks, summary, tmpDir,
} from './helpers.js';

/**
 * E-2 — детерминизм Decimal-сериализации SQLite REAL.
 * Критерии (docs/stage0-experiments.md): checksum одинаков при повторном чтении
 * в новом процессе и на копии файла БД; копия проходит integrity_check/foreign_key_check.
 */

function fieldsOf(rows: Array<{ id: number; val: Prisma.Decimal | null; name: string | null; createdAt: Date }>): Field[][] {
  return rows.map((r) => [
    { tag: 'I', v: r.id },
    r.val === null ? { tag: 'N' } : { tag: 'D', v: r.val },
    r.name === null ? { tag: 'N' } : { tag: 'S', v: r.name },
    { tag: 'T', v: r.createdAt },
  ]);
}

async function computeChecksum(url: string): Promise<string> {
  const db = newClient(url);
  try {
    const rows = await db.probeDecimal.findMany({ orderBy: { id: 'asc' } });
    return tableChecksum('probe_decimals', fieldsOf(rows));
  } finally {
    await db.$disconnect();
  }
}

async function seedDecimals(url: string): Promise<void> {
  const db = newClient(url);
  try {
    await initSchema(db);
    // Через Prisma Decimal (из строк, включая хвостовые нули)
    for (const [value, name] of [
      ['40.50', 'trailing-zero'],
      ['0.1', 'tenth'],
      ['0.00001', 'tiny'],
      ['0.000001', 'tiny-6'],
      ['123456789.123', 'big'],
      ['-12.250', 'negative'],
      ['3.0', 'integer-real'],
    ] as const) {
      await db.probeDecimal.create({
        data: { val: new Prisma.Decimal(value), name },
      });
    }
    // Через сырой REAL-литерал (как может сохранить SQLite)
    await db.$executeRawUnsafe(
      `INSERT INTO "probe_decimals" ("val", "name") VALUES (40.5, 'raw-40.5'), (NULL, 'raw-null')`,
    );
  } finally {
    await db.$disconnect();
  }
}

async function main(): Promise<number> {
  resetChecks();
  const mode = process.argv[2] ?? '--full';

  if (mode === '--full') {
    console.log('[E-2] Детерминизм Decimal-сериализации REAL');

    // 1. Заполнение и checksum в текущем процессе
    const file = freshDbFile('e2.db');
    const url = `file:${file}`;
    await seedDecimals(url);
    const hash1 = await computeChecksum(url);
    check('E-2: checksum прочитан (первый процесс)', /^[0-9a-f]{64}$/.test(hash1), hash1);

    // 2. Полный перезапуск процесса (настоящий новый Prisma Client) —
    //    дочерний процесс ОТКРЫВАЕТ ту же БД, ничего не пересоздавая
    const tsxCli = path.join(backendDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const scriptPath = path.join(backendDir, 'prisma', 'stage0', 'e2-decimal.ts');
    const rerun = spawnSync(process.execPath, [tsxCli, scriptPath, '--read'], {
      cwd: backendDir,
      encoding: 'utf8',
    });
    check('E-2: повторный запуск в новом процессе завершился без ошибок', rerun.status === 0, rerun.stderr.slice(0, 300));
    const hash2 = fs.existsSync(path.join(tmpDir, 'e2-checksum-restart.json'))
      ? (JSON.parse(fs.readFileSync(path.join(tmpDir, 'e2-checksum-restart.json'), 'utf8')) as { hash: string }).hash
      : '';
    check('E-2: checksum одинаков после закрытия и повторного открытия БД (новый процесс)', hash1 === hash2 && hash2 !== '', `${hash1} vs ${hash2}`);

    // 3. Копия файла БД (как при бэкапе) — checksum и проверки целостности
    const copyFile = dbFile('e2-copy.db');
    if (fs.existsSync(copyFile)) fs.rmSync(copyFile);
    fs.copyFileSync(file, copyFile);
    const hashCopy = await computeChecksum(`file:${copyFile}`);
    check('E-2: checksum копии файла БД совпадает с оригиналом', hashCopy === hash1, `${hashCopy} vs ${hash1}`);

    const copyDb = newClient(`file:${copyFile}`);
    try {
      const integrity = await copyDb.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
      check('E-2: integrity_check копии — ok', integrity[0]?.integrity_check === 'ok');
      const fk = await copyDb.$queryRawUnsafe('PRAGMA foreign_key_check');
      check('E-2: foreign_key_check копии — 0 строк', Array.isArray(fk) && fk.length === 0);
    } finally {
      await copyDb.$disconnect();
    }

    return summary('E-2');
  }

  if (mode === '--read') {
    // Режим дочернего процесса: ОТКРЫВАЕТ существующую e2.db (без пересоздания
    // и без засева — данные должны быть ровно те же, что видел первый процесс)
    const url = `file:${dbFile('e2.db')}`;
    const hash = await computeChecksum(url);
    fs.writeFileSync(path.join(tmpDir, 'e2-checksum-restart.json'), JSON.stringify({ hash }));
    process.exit(0);
  }

  console.error(`[E-2] неизвестный режим: ${mode}`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[E-2] ОШИБКА:', err);
    process.exit(1);
  },
);
