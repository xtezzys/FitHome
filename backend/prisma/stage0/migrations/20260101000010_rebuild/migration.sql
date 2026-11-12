-- Проба Шага 0 (миграция B): rebuild probe_exercises (NOT NULL name_lower/difficulty)
-- и probe_programs (user_id nullable) в варианте «парковка детей»: дочерние строки
-- выводятся до DROP родителя, т.к. Prisma Migrate 6.19.3 исполняет миграции с
-- немедленной FK-проверкой (defer_foreign_keys не действует в его контексте —
-- зафиксировано экспериментом E-B).
-- Применяется только к временным БД в prisma/stage0/tmp.

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

INSERT INTO "_new_probe_exercises" ("id", "name", "name_lower", "difficulty", "muscle_groups") SELECT "id", "name", lower("name"), 'medium', "muscle_groups" FROM "probe_exercises";

DROP TABLE "probe_exercises";

ALTER TABLE "_new_probe_exercises" RENAME TO "probe_exercises";

CREATE INDEX "probe_exercises_name_lower_idx" ON "probe_exercises"("name_lower");

CREATE TABLE "_new_probe_programs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT 1
);

INSERT INTO "_new_probe_programs" ("id", "user_id", "name", "is_active") SELECT "id", "user_id", "name", "is_active" FROM "probe_programs";

DROP TABLE "probe_programs";

ALTER TABLE "_new_probe_programs" RENAME TO "probe_programs";

INSERT INTO "probe_program_exercises" ("id", "program_id", "exercise_id", "ord", "target_weight") SELECT "id", "program_id", "exercise_id", "ord", "target_weight" FROM "_pe_park";

DROP TABLE "_pe_park";
