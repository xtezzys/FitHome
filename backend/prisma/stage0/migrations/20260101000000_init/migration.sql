-- Проба Шага 0: начальное состояние (аналог схемы ДО этапа 3).
-- Применяется только к временным БД в prisma/stage0/tmp.

CREATE TABLE "probe_exercises" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "muscle_groups" TEXT NOT NULL
);

CREATE TABLE "probe_programs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE "probe_program_exercises" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "program_id" INTEGER NOT NULL,
    "exercise_id" INTEGER NOT NULL,
    "ord" INTEGER NOT NULL,
    "target_weight" REAL,
    CONSTRAINT "probe_program_exercises_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "probe_programs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "probe_program_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "probe_exercises" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "probe_program_exercises_program_id_ord_key" ON "probe_program_exercises"("program_id", "ord");

CREATE TABLE "probe_decimals" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "val" REAL,
    "name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
