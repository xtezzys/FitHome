import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { isCanonicalCsv, normalizeName } from './stage3/normalize.js';

/**
 * Guard-проверка данных этапа 3: 0 строк с NULL nameLower, nameLower совпадает
 * с JS-нормализацией имени, difficulty заполнен, muscleGroups/equipment в
 * каноническом CSV-формате; целостность БД (foreign_key_check, integrity_check).
 *
 * Фазонезависим (raw-запросы). Запуск: npm run db:verify-stage3 [-- <DATABASE_URL>]
 * Exit 1 при любом нарушении.
 */

const problems: string[] = [];

function check(label: string, ok: boolean, details?: string): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${details ? ` — ${details}` : ''}`);
  if (!ok) problems.push(label);
}

export async function runVerify(datasourceUrl: string): Promise<boolean> {
  const db = new PrismaClient({ datasourceUrl });
  try {
    const rows = await db.$queryRawUnsafe<Array<{
      id: bigint;
      name: string;
      nameLower: string | null;
      difficulty: string | null;
      muscleGroups: string;
      equipment: string | null;
    }>>(
      `SELECT "id", "name", "nameLower", "difficulty", "muscleGroups", "equipment" FROM "exercises"`,
    );

    const nullNameLower = rows.filter((r) => r.nameLower === null).length;
    check('verify: нет строк с NULL nameLower', nullNameLower === 0, `нарушений: ${nullNameLower}`);

    const wrongNameLower = rows.filter((r) => r.nameLower !== null && r.nameLower !== normalizeName(r.name));
    check('verify: nameLower совпадает с JS-нормализацией имени', wrongNameLower.length === 0,
      wrongNameLower.slice(0, 3).map((r) => `#${r.id}`).join(', '));

    const nullDifficulty = rows.filter((r) => r.difficulty === null || r.difficulty.length === 0);
    check('verify: difficulty заполнен у всех', nullDifficulty.length === 0, `нарушений: ${nullDifficulty.length}`);

    const badMuscles = rows.filter((r) => !isCanonicalCsv(r.muscleGroups) || r.muscleGroups === null);
    check('verify: muscleGroups в каноническом CSV-формате', badMuscles.length === 0,
      badMuscles.slice(0, 3).map((r) => `#${r.id}: ${r.muscleGroups}`).join('; '));

    const badEquipment = rows.filter((r) => !isCanonicalCsv(r.equipment));
    check('verify: equipment в каноническом CSV-формате (или null)', badEquipment.length === 0,
      badEquipment.slice(0, 3).map((r) => `#${r.id}: ${r.equipment}`).join('; '));

    const fk = await db.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
    check('verify: foreign_key_check — 0 строк', Array.isArray(fk) && fk.length === 0, `нарушений: ${fk.length}`);

    const integrity = await db.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
    check('verify: integrity_check — ok', integrity.every((r) => r.integrity_check === 'ok'), JSON.stringify(integrity));

    for (const table of ['exercises', 'programs', 'program_exercises', 'workouts', 'workout_results']) {
      const count = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT COUNT(*) AS n FROM "${table}"`);
      console.log(`  счётчик ${table}: ${count[0]?.n}`);
    }
    return problems.length === 0;
  } finally {
    await db.$disconnect();
  }
}

// CLI-вход: только при прямом запуске (не при импорте оркестратором)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const urlArg = process.argv[2];
  const target = urlArg ?? process.env.DATABASE_URL;
  if (!target) {
    console.error('[verify] DATABASE_URL не задан (аргумент или .env)');
    process.exit(1);
  }
  console.log('[verify] Проверка данных этапа 3');
  runVerify(target).then(
    (ok) => {
      console.log(ok ? '[verify] ИТОГ: PASS' : '[verify] ИТОГ: FAIL');
      process.exit(ok ? 0 : 1);
    },
    (err) => {
      console.error('[verify] ОШИБКА:', err);
      process.exit(1);
    },
  );
}
