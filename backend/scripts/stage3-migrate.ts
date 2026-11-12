import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runBackfill } from '../prisma/backfill-stage3.js';
import { runVerify } from '../prisma/verify-stage3.js';

/**
 * Оркестратор миграции этапа 3 (docs/database.md §9, docs/stage0-experiments.md §6).
 *
 * Целевая БД задаётся переменной STAGE3_DATABASE_URL (обязательно) — оркестратор
 * НИКОГДА не угадывает базу: рабочая dev.db мигрируется только явной командой.
 *
 * Последовательность (подтверждена Шагом 0):
 *   1. preflight: версии prisma CLI === @prisma/client;
 *   2. `prisma migrate deploy`:
 *      - свежая/пустая БД: применяет A и B (B на пустой таблице безопасен);
 *      - БД с данными без backfill: A применяется, B безопасно падает с
 *        NOT NULL constraint failed: _new_exercises.nameLower (guard);
 *   3. при подтверждённой ожидаемой ошибке B — recovery:
 *        a) возврат детей из парковок (_pe_park/_wr_park/_w_park);
 *        b) удаление остатков (_new_*, парковки);
 *        c) JS-backfill (nameLower/CSV/difficulty);
 *        d) verify;
 *        e) `migrate resolve --rolled-back` (работает для failed — E-B);
 *        f) повторный deploy;
 *   4. финальный verify.
 * Любая иная ошибка — остановка с диагностикой, без resolve.
 */

const backendDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const prismaCli = path.join(backendDir, 'node_modules', 'prisma', 'build', 'index.js');
const schemaPath = path.join(backendDir, 'prisma', 'schema.prisma');

const MIGRATION_B = '20261112000100_stage3_exercises_programs_rebuild';

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
}

function fail(message: string, details?: string): never {
  console.error(`\n[stage3-migrate] ОСТАНОВКА: ${message}`);
  if (details) console.error(details);
  console.error('[stage3-migrate] Никакие изменения состояния миграций не выполнены автоматически.');
  process.exit(1);
}

function runPrisma(args: string[], databaseUrl: string): { status: number; out: string } {
  const result = spawnSync(process.execPath, [prismaCli, ...args, '--schema', schemaPath], {
    cwd: backendDir,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  return { status: result.status ?? -1, out: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

async function readMigrations(db: PrismaClient): Promise<MigrationRow[]> {
  try {
    return await db.$queryRawUnsafe<MigrationRow[]>(
      `SELECT "id", "migration_name", "finished_at", "rolled_back_at", "logs" FROM "_prisma_migrations" ORDER BY "id"`,
    );
  } catch {
    return []; // свежая БД — таблицы миграций ещё нет
  }
}

function countRows(db: PrismaClient, table: string): Promise<number> {
  return db
    .$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "${table}"`)
    .then((r) => Number(r[0]?.n ?? 0))
    .catch(() => 0);
}

async function tableExists(db: PrismaClient, table: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT "name" FROM "sqlite_master" WHERE "type" = 'table' AND "name" = ?`,
    table,
  );
  return rows.length > 0;
}

/** Возврат детей из парковок и удаление остатков неудачной миграции B. */
async function recoverLeftovers(db: PrismaClient): Promise<void> {
  const parks: Array<{ park: string; target: string; columns: string[] }> = [
    { park: '_w_park', target: 'workouts', columns: ['id', 'userId', 'programId', 'place', 'performedAt', 'notes', 'createdAt'] },
    { park: '_pe_park', target: 'program_exercises', columns: ['id', 'programId', 'exerciseId', 'order', 'targetSets', 'targetReps', 'targetWeight', 'targetDuration'] },
    { park: '_wr_park', target: 'workout_results', columns: ['id', 'workoutId', 'exerciseId', 'sets', 'reps', 'weight', 'duration', 'notes', 'createdAt'] },
  ];
  for (const { park, target, columns } of parks) {
    if (!(await tableExists(db, park))) continue;
    const restored = await db.$executeRawUnsafe(
      `INSERT INTO "${target}" (${columns.map((c) => `"${c}"`).join(', ')}) SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${park}" WHERE "${columns[0]}" NOT IN (SELECT "${columns[0]}" FROM "${target}")`,
    );
    console.log(`  [recovery] ${park} → ${target}: возвращено ${restored}`);
    await db.$executeRawUnsafe(`DROP TABLE "${park}"`);
  }
  for (const leftover of ['_new_exercises', '_new_programs']) {
    if (await tableExists(db, leftover)) {
      await db.$executeRawUnsafe(`DROP TABLE "${leftover}"`);
      console.log(`  [recovery] удалена таблица ${leftover}`);
    }
  }
}

function isExpectedGuardFailure(row: MigrationRow | undefined): boolean {
  return (
    !!row &&
    row.finished_at === null &&
    !!row.logs &&
    row.logs.includes('NOT NULL constraint failed') &&
    row.logs.includes('_new_exercises.')
  );
}

async function main(): Promise<void> {
  const target = process.env.STAGE3_DATABASE_URL;
  if (!target) {
    fail('переменная STAGE3_DATABASE_URL не задана. Пример: STAGE3_DATABASE_URL="file:./dev.db" npm run stage3:migrate');
  }
  console.log(`[stage3-migrate] Целевая БД: ${target}`);

  // 1. Preflight: версии prisma и @prisma/client должны совпадать
  const prismaVersion = JSON.parse(fs.readFileSync(path.join(backendDir, 'node_modules', 'prisma', 'package.json'), 'utf8')).version as string;
  const clientVersion = JSON.parse(fs.readFileSync(path.join(backendDir, 'node_modules', '@prisma/client', 'package.json'), 'utf8')).version as string;
  if (prismaVersion !== clientVersion) {
    fail(`версии не совпадают: prisma ${prismaVersion} !== @prisma/client ${clientVersion}. Выполните npm install и повторите.`);
  }
  console.log(`[stage3-migrate] Версии Prisma: ${prismaVersion} (CLI = client)`);
  if (!fs.existsSync(prismaCli)) fail(`не найден Prisma CLI: ${prismaCli}`);

  const db = new PrismaClient({ datasourceUrl: target });
  try {
    // 2. Первый deploy.
    // ВАЖНО: _prisma_migrations.id — UUID (не autoincrement), а после
    // resolve --rolled-back + повторного применения у миграции может быть
    // НЕСКОЛЬКО записей. Семантика состояния:
    //   «применена»  = существует запись с finished_at != null и rolled_back_at = null;
    //   «провалена»  = существует запись с finished_at = null.
    const isBApplied = (rows: MigrationRow[]) =>
      rows.some((m) => m.migration_name === MIGRATION_B && m.finished_at !== null && m.rolled_back_at === null);
    const failedBRow = (rows: MigrationRow[]) =>
      rows.find((m) => m.migration_name === MIGRATION_B && m.finished_at === null);

    let deploy = runPrisma(['migrate', 'deploy'], target);
    let migrations = await readMigrations(db);
    console.log(`[stage3-migrate] deploy #1: exit=${deploy.status}, B applied: ${isBApplied(migrations)}`);

    // 3. Ожидаемый guard-провал B на незаполненной базе → recovery-цикл
    if (deploy.status !== 0 && isExpectedGuardFailure(failedBRow(migrations))) {
      console.log('[stage3-migrate] Подтверждён ожидаемый guard-провал B (backfill не выполнен) — recovery');
      await recoverLeftovers(db);
      console.log('[stage3-migrate] Запуск JS-backfill (nameLower/CSV/difficulty через String.toLowerCase())');
      await runBackfill(target);
      const ok = await runVerify(target);
      if (!ok) fail('verify после backfill не пройден — дальнейшие шаги остановлены');
      const resolve = runPrisma(['migrate', 'resolve', '--rolled-back', MIGRATION_B], target);
      if (resolve.status !== 0) fail('migrate resolve --rolled-back завершился ошибкой', resolve.out.slice(-300));
      console.log('[stage3-migrate] Повторный deploy (B с заполненным backfill)');
      deploy = runPrisma(['migrate', 'deploy'], target);
      if (deploy.status !== 0) fail('повторный deploy завершился ошибкой', deploy.out.slice(-300));
      console.log('[stage3-migrate] deploy #2: exit=0');
    } else if (deploy.status !== 0) {
      fail('deploy завершился НЕОЖИДАННОЙ ошибкой — автоматическое восстановление запрещено', deploy.out.slice(-600));
    }

    // Проверка применения B: ретрай чтения состояния (запись обновляется
    // процессом deploy, который только что завершился)
    let applied = isBApplied(await readMigrations(db));
    for (let attempt = 1; attempt <= 5 && !applied; attempt += 1) {
      await new Promise((r) => setTimeout(r, 200));
      applied = isBApplied(await readMigrations(db));
    }
    if (!applied) {
      const rowsB = (await readMigrations(db)).filter((m) => m.migration_name === MIGRATION_B);
      fail(`миграция B (${MIGRATION_B}) не применена`,
        `${deploy.out.slice(-400)}\nзаписи B в _prisma_migrations: ${JSON.stringify(rowsB, null, 2)}`);
    }
    console.log('[stage3-migrate] Состояние после миграций: B applied');

    // 4. Финальный verify
    const ok = await runVerify(target);
    if (!ok) fail('финальный verify не пройден');
    console.log('[stage3-migrate] ИТОГ: PASS — миграции этапа 3 применены');
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('[stage3-migrate] ОШИБКА:', err);
  process.exit(1);
});
