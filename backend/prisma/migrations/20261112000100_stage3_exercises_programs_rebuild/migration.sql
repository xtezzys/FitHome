-- Этап 3, миграция B: rebuild exercises (nameLower/difficulty → NOT NULL) и
-- programs (userId → nullable) с ПАРКОВКОЙ дочерних записей.
--
-- Проверено экспериментами Шага 0 (docs/stage0-experiments.md):
-- - Prisma Migrate 6.19.3 исполняет миграции с НЕМЕДЛЕННОЙ FK-проверкой —
--   PRAGMA defer_foreign_keys в его контексте не действует, поэтому DROP
--   родителя возможен только без детей (парковка);
-- - guard: INSERT SELECT берёт уже ЗАПОЛНЕННЫЙ JS-backfill'ом "nameLower" —
--   на незаполненной базе миграция падает с
--   `NOT NULL constraint failed: _new_exercises.nameLower` ДО удаления данных;
-- - сбой не атомарен (остатки _new_*/_pe_park/_wr_park/_w_park) —
--   восстановление: scripts/stage3-migrate.ts (возврат детей из парковок).
-- Применяйте через оркестратор `npm run stage3:migrate`.

PRAGMA defer_foreign_keys=ON;

-- 1. Парковка детей exercises/programs
CREATE TABLE "_pe_park" (
    "id" INTEGER,
    "programId" INTEGER,
    "exerciseId" INTEGER,
    "order" INTEGER,
    "targetSets" INTEGER,
    "targetReps" INTEGER,
    "targetWeight" DECIMAL,
    "targetDuration" INTEGER
);
INSERT INTO "_pe_park" ("id", "programId", "exerciseId", "order", "targetSets", "targetReps", "targetWeight", "targetDuration") SELECT "id", "programId", "exerciseId", "order", "targetSets", "targetReps", "targetWeight", "targetDuration" FROM "program_exercises";

CREATE TABLE "_wr_park" (
    "id" INTEGER,
    "workoutId" INTEGER,
    "exerciseId" INTEGER,
    "sets" INTEGER,
    "reps" INTEGER,
    "weight" DECIMAL,
    "duration" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME
);
INSERT INTO "_wr_park" ("id", "workoutId", "exerciseId", "sets", "reps", "weight", "duration", "notes", "createdAt") SELECT "id", "workoutId", "exerciseId", "sets", "reps", "weight", "duration", "notes", "createdAt" FROM "workout_results";

CREATE TABLE "_w_park" (
    "id" INTEGER,
    "userId" INTEGER,
    "programId" INTEGER,
    "place" TEXT,
    "performedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME
);
INSERT INTO "_w_park" ("id", "userId", "programId", "place", "performedAt", "notes", "createdAt") SELECT "id", "userId", "programId", "place", "performedAt", "notes", "createdAt" FROM "workouts";

DELETE FROM "program_exercises";
DELETE FROM "workout_results";
DELETE FROM "workouts";

-- 2. Rebuild exercises: nameLower/difficulty → NOT NULL (equipment остаётся nullable)
CREATE TABLE "_new_exercises" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "nameLower" TEXT NOT NULL,
    "description" TEXT,
    "place" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "muscleGroups" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "equipment" TEXT,
    "userId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "_new_exercises" ("id", "name", "nameLower", "description", "place", "metric", "muscleGroups", "difficulty", "equipment", "userId", "createdAt") SELECT "id", "name", "nameLower", "description", "place", "metric", "muscleGroups", "difficulty", "equipment", "userId", "createdAt" FROM "exercises";

DROP TABLE "exercises";
ALTER TABLE "_new_exercises" RENAME TO "exercises";
CREATE INDEX "exercises_place_idx" ON "exercises"("place");
CREATE INDEX "exercises_userId_idx" ON "exercises"("userId");
CREATE UNIQUE INDEX "exercises_userId_name_key" ON "exercises"("userId", "name");

-- 3. Rebuild programs: userId → nullable (null = готовая программа каталога)
CREATE TABLE "_new_programs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "place" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "_new_programs" ("id", "userId", "name", "description", "place", "isActive", "createdAt", "updatedAt") SELECT "id", "userId", "name", "description", "place", "isActive", "createdAt", "updatedAt" FROM "programs";

DROP TABLE "programs";
ALTER TABLE "_new_programs" RENAME TO "programs";
CREATE INDEX "programs_userId_isActive_idx" ON "programs"("userId", "isActive");

-- 4. Возврат детей (порядок: родители раньше детей; workout_results требует workouts)
INSERT INTO "workouts" ("id", "userId", "programId", "place", "performedAt", "notes", "createdAt") SELECT "id", "userId", "programId", "place", "performedAt", "notes", "createdAt" FROM "_w_park";
INSERT INTO "program_exercises" ("id", "programId", "exerciseId", "order", "targetSets", "targetReps", "targetWeight", "targetDuration") SELECT "id", "programId", "exerciseId", "order", "targetSets", "targetReps", "targetWeight", "targetDuration" FROM "_pe_park";
INSERT INTO "workout_results" ("id", "workoutId", "exerciseId", "sets", "reps", "weight", "duration", "notes", "createdAt") SELECT "id", "workoutId", "exerciseId", "sets", "reps", "weight", "duration", "notes", "createdAt" FROM "_wr_park";

DROP TABLE "_w_park";
DROP TABLE "_pe_park";
DROP TABLE "_wr_park";
