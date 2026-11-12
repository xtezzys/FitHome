import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { check, dbUrl, freshDbFile, newClient, resetChecks, seed, stage0Dir, summary, tmpDir } from './helpers.js';

/**
 * E-B — поведение Prisma Migrate 6.19.3 на SQLite (временная БД).
 *
 * Миграции подаются поэтапно через временную копию схемы (tmp/eb) — подмножество
 * каталога migrations контролируется копированием файлов, поэтому deploy всегда
 * применяет ровно то, что нужно текущей фазе:
 *   фаза 1: deploy 0001_init → старая схема;
 *   засев данных; фаза 2: deploy 0010_rebuild → rebuild НА БД С ДАННЫМИ;
 *   фаза 3: deploy 0020_rebuild_fail → failed-запись в _prisma_migrations,
 *   точный текст ошибки, атомарность отката, recovery через resolve --rolled-back
 *   (работает только для failed-миграций — P3012 для applied, зафиксировано).
 */

const prismaCli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
const ebDir = path.join(tmpDir, 'eb');
const ebSchema = path.join(ebDir, 'probe.prisma');
const ebMigrations = path.join(ebDir, 'migrations');

function runPrisma(args: string[], dbFileUrl: string): { status: number; out: string } {
  const result = spawnSync(process.execPath, [prismaCli, ...args, '--schema', ebSchema], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, PROBE_DATABASE_URL: dbFileUrl },
  });
  return { status: result.status ?? -1, out: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

function copyMigration(name: string): void {
  const src = path.join(stage0Dir, 'migrations', name, 'migration.sql');
  const destDir = path.join(ebMigrations, name);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, path.join(destDir, 'migration.sql'));
}

function listMigrations(): string[] {
  return fs.readdirSync(ebMigrations).filter((n) => !n.startsWith('.')).sort();
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
}

async function main(): Promise<number> {
  resetChecks();
  console.log('[E-B] Поведение Prisma Migrate 6.19.3 (SQLite, временная БД)');

  // Подготовка временной схемы: probe.prisma + пустой каталог migrations
  fs.rmSync(ebDir, { recursive: true, force: true });
  fs.mkdirSync(ebMigrations, { recursive: true });
  fs.copyFileSync(path.join(stage0Dir, 'probe.prisma'), ebSchema);

  const file = freshDbFile('eb.db');
  fs.closeSync(fs.openSync(file, 'w'));
  const url = dbUrl('eb.db');

  // Фаза 1: только init
  copyMigration('20260101000000_init');
  const deployInit = runPrisma(['migrate', 'deploy'], url);
  check('E-B: deploy 0001_init применён', deployInit.status === 0, deployInit.out.slice(-150));
  check('E-B: миграций в каталоге — 1', listMigrations().length === 1, JSON.stringify(listMigrations()));

  // Засев данных
  const db = newClient(url);
  try {
    const colsBefore = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("probe_exercises")`);
    check('E-B: probe_exercises в старой схеме (без name_lower)', !colsBefore.some((c) => c.name === 'name_lower'));
    await seed(db);

    // Фаза 2: rebuild на БД с данными
    copyMigration('20260101000010_rebuild');
    const deployRebuild = runPrisma(['migrate', 'deploy'], url);
    check('E-B: deploy применяет rebuild НА БД С ДАННЫМИ (DROP родителя с FK-детьми не падает)', deployRebuild.status === 0, deployRebuild.out.slice(-300));

    const children = await db.$queryRawUnsafe<Array<{ id: number }>>(
      `SELECT "id" FROM "probe_program_exercises" ORDER BY "id"`,
    );
    check('E-B: строки probe_program_exercises сохранены после Migrate-rebuild', children.length === 3, `строк: ${children.length}`);

    const lowered = await db.$queryRawUnsafe<Array<{ name: string; name_lower: string }>>(
      `SELECT "name", "name_lower" FROM "probe_exercises" ORDER BY "id"`,
    );
    console.log(`    name_lower после SQL lower(): ${JSON.stringify(lowered.map((r) => r.name_lower))}`);
    check('E-B: SQL lower() ASCII-only — кириллица не изменена (ожидаемо, backfill обязателен в JS)',
      lowered[0]?.name_lower === 'Отжимания');

    const fk = await db.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
    check('E-B: foreign_key_check после Migrate-rebuild — 0 строк', Array.isArray(fk) && fk.length === 0);

    // Фаза 3: заведомо падающая миграция
    copyMigration('20260101000020_rebuild_fail');
    const deployFail = runPrisma(['migrate', 'deploy'], url);
    check('E-B: падающая миграция возвращает ненулевой exit code', deployFail.status !== 0, `exit: ${deployFail.status}`);
    console.log(`    stderr падающего deploy (фрагмент): ${deployFail.out.slice(-250).replace(/\n/g, ' | ')}`);

    const migrations = await db.$queryRawUnsafe<MigrationRow[]>(
      `SELECT "migration_name", "finished_at", "rolled_back_at", "logs" FROM "_prisma_migrations" ORDER BY "migration_name"`,
    );
    for (const m of migrations) {
      console.log(`    _prisma_migrations: ${m.migration_name} | finished=${m.finished_at ? 'yes' : 'no'} | rolled_back=${m.rolled_back_at ? 'yes' : 'no'}`);
      if (m.migration_name.includes('rebuild_fail') && m.logs) {
        console.log(`    >>> текст ошибки из logs: ${m.logs.slice(0, 300)}`);
      }
    }
    const failed = migrations.find((m) => m.migration_name.includes('rebuild_fail'));
    check('E-B: failed-миграция зафиксирована (finished_at IS NULL, logs не пусты)',
      !!failed && failed.finished_at === null && !!failed.logs);
    check('E-B: в logs есть NOT NULL constraint failed на _new_probe_exercises.name_lower',
      !!failed?.logs && failed.logs.includes('NOT NULL constraint failed') && failed.logs.includes('name_lower'),
      failed?.logs?.slice(0, 200));

    // НАХОДКА: Prisma Migrate для SQLite НЕ откатывает миграцию атомарно —
    // остаются мусорные таблицы, а «припаркованные» дети ВЫСЕЛЕНЫ из таблицы
    // (0 строк) и лежат в _pe_park. Восстановление — обязательная часть процедуры.
    const leftovers = await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND ("name" LIKE '_new_%' OR "name" LIKE '_pe_%') ORDER BY "name"`,
    );
    console.log(`    остатки после сбоя: ${JSON.stringify(leftovers.map((t) => t.name))}`);
    check('E-B: сбой неатомарен — остаются _new_probe_exercises и _pe_park',
      leftovers.map((t) => t.name).join(',') === '_new_probe_exercises,_pe_park', JSON.stringify(leftovers.map((t) => t.name)));
    const exCount = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "probe_exercises"`);
    check('E-B: упражнения после сбоя целы (4 строки, DROP не выполнился)', Number(exCount[0]?.n) === 4, `строк: ${exCount[0]?.n}`);
    const peCount = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "probe_program_exercises"`);
    const parkCount = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "_pe_park"`);
    check('E-B: дети выселены из таблицы (0), но сохранены в _pe_park (3)',
      Number(peCount[0]?.n) === 0 && Number(parkCount[0]?.n) === 3, `таблица: ${peCount[0]?.n}, парковка: ${parkCount[0]?.n}`);

    // Recovery: resolve --rolled-back успешен именно для failed-миграции
    const recover = runPrisma(['migrate', 'resolve', '--rolled-back', '20260101000020_rebuild_fail'], url);
    check('E-B: resolve --rolled-back успешен для failed-миграции (P3012 только для applied)', recover.status === 0, recover.out.slice(-150));
    // Повторный deploy после resolve: fail-миграция снова pending → падает вновь (ожидаемо)
    const redeploy = runPrisma(['migrate', 'deploy'], url);
    console.log(`    повторный deploy после resolve: exit=${redeploy.status} (ожидаемо 1 — fail-миграция pending)`);
    check('E-B: deploy после resolve --rolled-back снова пытается применить fail-миграцию', redeploy.status !== 0);
    const afterRecover = await db.$queryRawUnsafe<MigrationRow[]>(
      `SELECT "migration_name", "finished_at", "rolled_back_at", "logs" FROM "_prisma_migrations" WHERE "migration_name" LIKE '%rebuild_fail'`,
    );
    const rolled = afterRecover[0];
    console.log(`    состояние fail-миграции после resolve+deploy: finished=${rolled?.finished_at ? 'yes' : 'no'} | rolled_back=${rolled?.rolled_back_at ? 'yes' : 'no'} (записей: ${afterRecover.length})`);
    check('E-B: запись fail-миграции после resolve+deploy присутствует и не завершена (нужна ручная разметка)', !!rolled && rolled.finished_at === null);
  } finally {
    await db.$disconnect();
  }

  const status = runPrisma(['migrate', 'status'], url);
  console.log(`    migrate status (exit ${status.status}):\n${status.out.trim().slice(-400)}`);

  return summary('E-B');
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[E-B] ОШИБКА:', err);
    process.exit(1);
  },
);
