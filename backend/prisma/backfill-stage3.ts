import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { normalizeCsv, normalizeName } from './stage3/normalize.js';

/**
 * JS-backfill этапа 3: заполняет nameLower (String.toLowerCase() — корректная
 * кириллица, SQL lower() в SQLite ASCII-only), difficulty (нейтральное "medium")
 * и нормализует muscleGroups/equipment в канонический CSV-формат.
 *
 * Фазонезависим: работает и до миграции B (nullable-колонки миграции A), и после
 * неё (NOT NULL) — raw-запросы через Prisma Client, не зависят от типов клиента.
 * Инструментальное исключение из правила «без сырого SQL» (docs/database.md §9).
 *
 * Идемпотентен: повторный запуск перезаписывает теми же значениями.
 *
 * Запуск: npm run db:backfill-stage3 [-- <DATABASE_URL>]
 * (без аргумента — DATABASE_URL из .env, т.е. рабочая база).
 */

interface ExerciseRow {
  id: bigint;
  name: string;
  difficulty: string | null;
  equipment: string | null;
  muscleGroups: string;
  nameLower: string | null;
}

export async function runBackfill(datasourceUrl: string): Promise<{ updated: number; skipped: number }> {
  const db = new PrismaClient({ datasourceUrl });
  try {
    const rows = await db.$queryRawUnsafe<ExerciseRow[]>(
      `SELECT "id", "name", "difficulty", "equipment", "muscleGroups", "nameLower" FROM "exercises"`,
    );
    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      const nameLower = normalizeName(row.name);
      const difficulty = row.difficulty ?? 'medium';
      // muscleGroups NOT NULL: пустой набор (артефакт данных) → нейтральный токен
      const muscleGroups = normalizeCsv(row.muscleGroups) ?? ',other,';
      const equipment = normalizeCsv(row.equipment);
      if (
        row.nameLower === nameLower &&
        row.difficulty === difficulty &&
        row.muscleGroups === muscleGroups &&
        row.equipment === equipment
      ) {
        skipped += 1;
        continue;
      }
      await db.$executeRawUnsafe(
        `UPDATE "exercises" SET "nameLower" = ?, "difficulty" = ?, "muscleGroups" = ?, "equipment" = ? WHERE "id" = ?`,
        nameLower,
        difficulty,
        muscleGroups,
        equipment,
        row.id,
      );
      updated += 1;
    }
    console.log(`[backfill] упражнений: ${rows.length}, обновлено: ${updated}, без изменений: ${skipped}`);
    return { updated, skipped };
  } finally {
    await db.$disconnect();
  }
}

// CLI-вход: выполняется только при ПРЯМОМ запуске файла (не при импорте
// оркестратором — иначе top-level код уронил бы родительский процесс)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const urlArg = process.argv[2];
  const target = urlArg ?? process.env.DATABASE_URL;
  if (!target) {
    console.error('[backfill] DATABASE_URL не задан (аргумент или .env)');
    process.exit(1);
  }
  runBackfill(target).then(
    () => process.exit(0),
    (err) => {
      console.error('[backfill] ОШИБКА:', err);
      process.exit(1);
    },
  );
}
