import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Интеграционная проверка блока миграции этапа 3 — ТОЛЬКО на временных БД
 * (prisma/stage3-test-tmp/). Рабочая dev.db используется ТОЛЬКО на чтение
 * (копируется как основа сценария «существующая БД») и не изменяется.
 *
 * Сценарий 1 (существующая БД + recovery): копия dev.db с тестовыми данными
 *   (кириллица, «грязный» CSV, программа с составом, тренировка с результатами)
 *   → оркестратор: A ok → B падает (guard) → recovery (возврат детей, backfill,
 *   verify, resolve --rolled-back) → B → финальный verify → seed ×2 (идемпотентность).
 * Сценарий 2 (свежая БД): пустая БД → оркестратор (A+B одним deploy) → seed ×2.
 */

const tsxCli = path.join(backend, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const testDir = path.join(backend, 'prisma', 'stage3-test-tmp');
const devDb = path.join(backend, 'prisma', 'dev.db');

let failures = 0;
// details допускает null/undefined: значения полей Prisma (equipment и др.) могут быть null
function check(label: string, ok: boolean, details?: string | null): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${details !== undefined && details !== null ? ` — ${details}` : ''}`);
  if (!ok) failures += 1;
}

function runScript(script: string, databaseUrl: string, envVar = 'STAGE3_DATABASE_URL'): { status: number; out: string } {
  const res = spawnSync(process.execPath, [tsxCli, path.join(backend, script)], {
    cwd: backend,
    encoding: 'utf8',
    env: { ...process.env, [envVar]: databaseUrl },
  });
  return { status: res.status ?? -1, out: `${res.stdout ?? ''}\n${res.stderr ?? ''}` };
}

function freshFile(name: string, source?: string): string {
  fs.mkdirSync(testDir, { recursive: true });
  const file = path.join(testDir, name);
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(file + suffix)) fs.rmSync(file + suffix);
  }
  if (source) fs.copyFileSync(source, file);
  else fs.closeSync(fs.openSync(file, 'w'));
  return file;
}

interface Row {
  id: number;
  programId?: number | null;
  exerciseId?: number | null;
  workoutId?: number | null;
}

async function childrenSnapshot(db: PrismaClient): Promise<Row[]> {
  const pe = await db.$queryRawUnsafe<Row[]>(`SELECT "id", "programId", "exerciseId", "order" FROM "program_exercises" ORDER BY "id"`);
  const wr = await db.$queryRawUnsafe<Row[]>(`SELECT "id", "workoutId", "exerciseId", "sets" FROM "workout_results" ORDER BY "id"`);
  const w = await db.$queryRawUnsafe<Row[]>(`SELECT "id", "userId", "programId", "place" FROM "workouts" ORDER BY "id"`);
  return [...pe, ...wr, ...w];
}

async function counts(db: PrismaClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ['exercises', 'programs', 'program_exercises', 'workouts', 'workout_results']) {
    const r = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "${t}"`);
    out[t] = Number(r[0]?.n ?? 0);
  }
  return out;
}

/** Копия схемы и миграций init_auth + A (старая схема + nullable-колонки) во временную папку. */
function prepareTempSchema(): string {
  const dir = path.join(testDir, 'schema');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'migrations', '20261111191107_init_auth'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'migrations', '20261112000000_stage3_add_columns'), { recursive: true });
  fs.copyFileSync(path.join(backend, 'prisma', 'schema.prisma'), path.join(dir, 'schema.prisma'));
  fs.copyFileSync(
    path.join(backend, 'prisma', 'migrations', '20261111191107_init_auth', 'migration.sql'),
    path.join(dir, 'migrations', '20261111191107_init_auth', 'migration.sql'),
  );
  fs.copyFileSync(
    path.join(backend, 'prisma', 'migrations', '20261112000000_stage3_add_columns', 'migration.sql'),
    path.join(dir, 'migrations', '20261112000000_stage3_add_columns', 'migration.sql'),
  );
  return path.join(dir, 'schema.prisma');
}

async function scenarioExisting(): Promise<void> {
  console.log('\n=== Сценарий 1: существующая БД с данными (recovery-путь) ===');
  // Старая схема (init_auth + nullable-колонки A) во временной копии схемы
  const tempSchema = prepareTempSchema();
  const file = freshFile('existing.db');
  const deploy = spawnSync(process.execPath, [tsxCli, path.join(backend, 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate', 'deploy', '--schema', tempSchema], {
    cwd: backend, encoding: 'utf8', env: { ...process.env, DATABASE_URL: `file:${file}` },
  });
  const deployOut = `${deploy.stdout ?? ''}\n${deploy.stderr ?? ''}`;
  check('Сценарий 1: deploy init_auth + A на временной схеме', deploy.status === 0, deployOut.slice(-200));

  const url = `file:${file}`;
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    // Тестовые данные старой схемы: упражнения через raw (типизированный клиент
    // требует nameLower), остальные таблицы не изменились — через модели
    const user1 = await db.user.create({
      data: { email: 'stage3-test@example.com', passwordHash: 'x'.repeat(60), name: 'Тест' },
    });
    await db.$executeRawUnsafe(
      `INSERT INTO "exercises" ("name", "description", "place", "metric", "muscleGroups", "userId") VALUES
       ('Отжимания', 'Классические отжимания', 'home', 'reps', 'Chest, , TRICEPS ,chest', NULL),
       ('Приседания со штангой', NULL, 'gym', 'reps_weight', 'quads, glutes', NULL),
       ('Планка', NULL, 'home', 'time', 'abs, core', ?)`,
      user1.id,
    );
    // equipment «грязного» формата появлялся бы у пользователей; вставляем после A
    await db.$executeRawUnsafe(`UPDATE "exercises" SET "equipment" = '  Bench , DUMBBELL ,bench' WHERE "name" = 'Приседания со штангой'`);
    const shared = (await db.$queryRawUnsafe<Array<{ id: number }>>(`SELECT "id" FROM "exercises" WHERE "name" = 'Отжимания'`))[0];
    const shared2 = (await db.$queryRawUnsafe<Array<{ id: number }>>(`SELECT "id" FROM "exercises" WHERE "name" = 'Приседания со штангой'`))[0];
    const personal = (await db.$queryRawUnsafe<Array<{ id: number }>>(`SELECT "id" FROM "exercises" WHERE "name" = 'Планка' AND "userId" IS NOT NULL`))[0];
    const program = await db.program.create({
      data: { userId: user1.id, name: 'Моя программа', place: 'home' },
    });
    const pe1 = await db.programExercise.create({
      data: { programId: program.id, exerciseId: shared.id, order: 1, targetSets: 3, targetReps: 15 },
    });
    const pe2 = await db.programExercise.create({
      data: { programId: program.id, exerciseId: personal.id, order: 2, targetSets: 3, targetDuration: 40 },
    });
    const workout = await db.workout.create({
      data: { userId: user1.id, programId: program.id, place: 'home' },
    });
    const wr1 = await db.workoutResult.create({
      data: { workoutId: workout.id, exerciseId: shared.id, sets: 3, reps: 15, weight: null },
    });
    const wr2 = await db.workoutResult.create({
      data: { workoutId: workout.id, exerciseId: personal.id, sets: 3, duration: 40 },
    });

    void shared2;
    const beforeCounts = await counts(db);
    const beforeChildren = await childrenSnapshot(db);
    await db.$disconnect();

    // Оркестратор: A → B (guard-провал) → recovery → backfill → verify → B
    const result = runScript('scripts/stage3-migrate.ts', url);
    if (result.status !== 0) {
      console.log(`---- полный вывод оркестратора (FAIL) ----\n${result.out}\n---- конец ----`);
    }
    check('Сценарий 1: оркестратор завершился успешно (recovery-путь)', result.status === 0, result.out.slice(-600));
    if (result.status !== 0) return;

    const db2 = new PrismaClient({ datasourceUrl: url });
    try {
      const migrations = await db2.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>(
        `SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations" ORDER BY "id"`,
      );
      const rowsA = migrations.filter((m) => m.migration_name.startsWith('20261112000000'));
      const rowsB = migrations.filter((m) => m.migration_name.startsWith('20261112000100'));
      // После recovery у B две записи (guard-провал + успешное повторное применение).
      // id записи — UUID (порядок случайен), поэтому «применена» = есть запись
      // с finished_at != null и rolled_back_at = null
      const bApplied = rowsB.some((m) => m.finished_at !== null && m.rolled_back_at === null);
      check('Сценарий 1: миграция A применена, B применена повторно после recovery',
        rowsA.length === 1 && rowsA[0].finished_at !== null && bApplied,
        `A: ${rowsA.length} зап., B: ${rowsB.length} зап.`);

      const cols = await db2.$queryRawUnsafe<Array<{ name: string; notnull: number | bigint }>>(`PRAGMA table_info("exercises")`);
      const byName = Object.fromEntries(cols.map((c) => [c.name, Number(c.notnull)]));
      check('Сценарий 1: nameLower/difficulty NOT NULL, equipment nullable',
        byName['nameLower'] === 1 && byName['difficulty'] === 1 && byName['equipment'] === 0, JSON.stringify(byName));

      const progCols = await db2.$queryRawUnsafe<Array<{ name: string; notnull: number | bigint }>>(`PRAGMA table_info("programs")`);
      const userId = progCols.find((c) => c.name === 'userId');
      check('Сценарий 1: programs.userId стал nullable', !!userId && Number(userId.notnull) === 0);

      const otzh = await db2.exercise.findFirst({ where: { userId: null, name: 'Отжимания' } });
      check('Сценарий 1: кириллический backfill — nameLower("Отжимания") = "отжимания"', otzh?.nameLower === 'отжимания', otzh?.nameLower);
      check('Сценарий 1: CSV нормализован из "Chest, , TRICEPS ,chest" в ",chest,triceps,"', otzh?.muscleGroups === ',chest,triceps,', otzh?.muscleGroups);
      check('Сценарий 1: difficulty заполнен нейтральным "medium"', otzh?.difficulty === 'medium');
      const pris = await db2.exercise.findFirst({ where: { userId: null, name: 'Приседания со штангой' } });
      check('Сценарий 1: equipment нормализован в ",bench,dumbbell,"', pris?.equipment === ',bench,dumbbell,', pris?.equipment);
      const plank = await db2.exercise.findFirst({ where: { userId: { not: null }, name: 'Планка' } });
      check('Сценарий 1: персональное упражнение не потеряно и нормализовано', plank?.muscleGroups === ',abs,core,', plank?.muscleGroups);

      const afterCounts = await counts(db2);
      check('Сценарий 1: счётчики всех таблиц сохранены',
        JSON.stringify(beforeCounts) === JSON.stringify(afterCounts), `${JSON.stringify(beforeCounts)} → ${JSON.stringify(afterCounts)}`);
      const afterChildren = await childrenSnapshot(db2);
      check('Сценарий 1: дети (состав/тренировки/результаты) с теми же id и ссылками',
        JSON.stringify(afterChildren) === JSON.stringify(beforeChildren));

      const pe1After = await db2.programExercise.findUnique({ where: { id: pe1.id } });
      const pe2After = await db2.programExercise.findUnique({ where: { id: pe2.id } });
      const wr1After = await db2.workoutResult.findUnique({ where: { id: wr1.id } });
      const wr2After = await db2.workoutResult.findUnique({ where: { id: wr2.id } });
      check('Сценарий 1: связи ProgramExercise указывают на те же программы/упражнения',
        pe1After?.programId === program.id && pe1After?.exerciseId === shared.id &&
        pe2After?.programId === program.id && pe2After?.exerciseId === personal.id);
      check('Сценарий 1: связи WorkoutResult указывают на те же тренировки/упражнения',
        wr1After?.workoutId === workout.id && wr1After?.exerciseId === shared.id &&
        wr2After?.workoutId === workout.id && wr2After?.exerciseId === personal.id);

      // Seed ×2 — идемпотентность
      const seed1 = runScript('prisma/seed.ts', url, 'DATABASE_URL');
      check('Сценарий 1: seed #1 успешен', seed1.status === 0, seed1.out.slice(-200));
      const countsAfterSeed1 = await counts(db2);
      const seed2 = runScript('prisma/seed.ts', url, 'DATABASE_URL');
      check('Сценарий 1: seed #2 успешен', seed2.status === 0, seed2.out.slice(-200));
      const countsAfterSeed2 = await counts(db2);
      check('Сценарий 1: seed идемпотентен — счётчики не изменились между запусками',
        JSON.stringify(countsAfterSeed1) === JSON.stringify(countsAfterSeed2),
        `${JSON.stringify(countsAfterSeed1)} → ${JSON.stringify(countsAfterSeed2)}`);
      const planokCount = await db2.exercise.count({ where: { nameLower: 'планка' } });
      check('Сценарий 1: общая «Планка» создана рядом с персональной (без конфликта уникальности)', planokCount === 2, `найдено: ${planokCount}`);
      const dupCheck = await db2.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT COUNT(*) AS n FROM "exercises" WHERE "userId" IS NULL AND "nameLower" = 'отжимания'`,
      );
      check('Сценарий 1: нет дубликатов общих упражнений после двойного seed', Number(dupCheck[0]?.n) === 1);
    } finally {
      await db2.$disconnect();
      void wr1; void wr2; void pe1; void pe2;
    }
  } finally {
    void db;
  }
}

async function scenarioFresh(): Promise<void> {
  console.log('\n=== Сценарий 2: свежая пустая БД (A+B одним deploy) ===');
  const file = freshFile('fresh.db');
  const url = `file:${file}`;
  const result = runScript('scripts/stage3-migrate.ts', url);
  check('Сценарий 2: оркестратор на пустой БД завершился успешно', result.status === 0, result.out.slice(-400));

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const migrations = await db.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>(
      `SELECT "migration_name", "finished_at" FROM "_prisma_migrations" ORDER BY "migration_name"`,
    );
    check('Сценарий 2: все 3 миграции применены',
      migrations.length === 3 && migrations.every((m) => m.finished_at !== null), JSON.stringify(migrations.map((m) => m.migration_name)));

    const seed1 = runScript('prisma/seed.ts', url, 'DATABASE_URL');
    check('Сценарий 2: seed #1 успешен', seed1.status === 0, seed1.out.slice(-200));
    const c1 = await counts(db);
    check('Сценарий 2: seed создал 26 упражнений и 4 готовые программы',
      c1['exercises'] === 26 && c1['programs'] === 4 && c1['program_exercises'] === 19, JSON.stringify(c1));
    const seed2 = runScript('prisma/seed.ts', url, 'DATABASE_URL');
    const c2 = await counts(db);
    check('Сценарий 2: seed ×2 идемпотентен', seed2.status === 0 && JSON.stringify(c1) === JSON.stringify(c2), JSON.stringify(c2));
  } finally {
    await db.$disconnect();
  }
}

async function main(): Promise<void> {
  console.log('[stage3-verify] Интеграционная проверка блока миграции (только временные БД)');
  await scenarioExisting();
  await scenarioFresh();
  console.log(failures === 0 ? '\n[stage3-verify] ИТОГ: PASS — все проверки зелёные' : `\n[stage3-verify] ИТОГ: FAIL — провалено: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[stage3-verify] ОШИБКА:', err);
  process.exit(1);
});
