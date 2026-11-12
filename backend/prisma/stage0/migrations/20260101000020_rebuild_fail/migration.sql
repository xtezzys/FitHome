-- Проба Шага 0: ЗАВЕДОМО падающая миграция (парковка + искусственное нарушение
-- NOT NULL name_lower = NULL) для фиксации точного текста ошибки, поведения
-- _prisma_migrations при сбое и состава остатков (_new_*, _pe_park) после отката.
-- Никогда не применяется к рабочей базе.

PRAGMA defer_foreign_keys=ON;

CREATE TABLE "_pe_park" (
    "id" INTEGER,
    "program_id" INTEGER,
    "exercise_id" INTEGER,
    "ord" INTEGER,
    "target_weight" REAL
);

INSERT INTO "_pe_park" ("id", "program_id", "exercise_id", "ord", "target_weight") SELECT "id", "program_id", "exercise_id", "ord", "target_weight" FROM "probe_program_exercises";

DELETE FROM "probe_program_exercises";

CREATE TABLE "_new_probe_exercises" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "name_lower" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "muscle_groups" TEXT NOT NULL
);

INSERT INTO "_new_probe_exercises" ("id", "name", "name_lower", "difficulty", "muscle_groups") SELECT "id", "name", NULL, 'medium', "muscle_groups" FROM "probe_exercises";
