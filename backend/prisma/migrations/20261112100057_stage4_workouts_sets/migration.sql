/*
  Warnings:

  - You are about to drop the column `duration` on the `workout_results` table. All the data in the column will be lost.
  - You are about to drop the column `reps` on the `workout_results` table. All the data in the column will be lost.
  - You are about to drop the column `sets` on the `workout_results` table. All the data in the column will be lost.
  - You are about to drop the column `weight` on the `workout_results` table. All the data in the column will be lost.
  - You are about to drop the column `performedAt` on the `workouts` table. All the data in the column will be lost.
  - Added the required column `exerciseMetric` to the `workout_results` table without a default value. This is not possible if the table is not empty.
  - Added the required column `exerciseName` to the `workout_results` table without a default value. This is not possible if the table is not empty.
  - Added the required column `order` to the `workout_results` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "workout_sets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workoutResultId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "reps" INTEGER,
    "weight" DECIMAL,
    "duration" INTEGER,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "workout_sets_workoutResultId_fkey" FOREIGN KEY ("workoutResultId") REFERENCES "workout_results" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_exercises" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "exercises_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_exercises" ("createdAt", "description", "difficulty", "equipment", "id", "metric", "muscleGroups", "name", "nameLower", "place", "userId") SELECT "createdAt", "description", "difficulty", "equipment", "id", "metric", "muscleGroups", "name", "nameLower", "place", "userId" FROM "exercises";
DROP TABLE "exercises";
ALTER TABLE "new_exercises" RENAME TO "exercises";
CREATE INDEX "exercises_place_idx" ON "exercises"("place");
CREATE INDEX "exercises_userId_idx" ON "exercises"("userId");
CREATE UNIQUE INDEX "exercises_userId_name_key" ON "exercises"("userId", "name");
CREATE TABLE "new_programs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "place" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "programs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_programs" ("createdAt", "description", "id", "isActive", "name", "place", "updatedAt", "userId") SELECT "createdAt", "description", "id", "isActive", "name", "place", "updatedAt", "userId" FROM "programs";
DROP TABLE "programs";
ALTER TABLE "new_programs" RENAME TO "programs";
CREATE INDEX "programs_userId_isActive_idx" ON "programs"("userId", "isActive");
CREATE TABLE "new_workout_results" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workoutId" INTEGER NOT NULL,
    "exerciseId" INTEGER,
    "programExerciseId" INTEGER,
    "exerciseName" TEXT NOT NULL,
    "exerciseMetric" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workout_results_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "workouts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workout_results_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "exercises" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workout_results_programExerciseId_fkey" FOREIGN KEY ("programExerciseId") REFERENCES "program_exercises" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_workout_results" ("createdAt", "exerciseId", "id", "notes", "workoutId") SELECT "createdAt", "exerciseId", "id", "notes", "workoutId" FROM "workout_results";
DROP TABLE "workout_results";
ALTER TABLE "new_workout_results" RENAME TO "workout_results";
CREATE INDEX "workout_results_exerciseId_idx" ON "workout_results"("exerciseId");
CREATE UNIQUE INDEX "workout_results_workoutId_order_key" ON "workout_results"("workoutId", "order");
CREATE TABLE "new_workouts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "programId" INTEGER,
    "programName" TEXT,
    "place" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "durationSec" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workouts_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_workouts" ("createdAt", "id", "notes", "place", "programId", "userId") SELECT "createdAt", "id", "notes", "place", "programId", "userId" FROM "workouts";
DROP TABLE "workouts";
ALTER TABLE "new_workouts" RENAME TO "workouts";
CREATE INDEX "workouts_userId_startedAt_idx" ON "workouts"("userId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "workout_sets_workoutResultId_order_key" ON "workout_sets"("workoutResultId", "order");

-- Этап 4: частичный уникальный индекс — максимум одна активная (in_progress)
-- тренировка на пользователя; закрывает гонку параллельных POST /api/workouts
-- на уровне СУБД (план этапа 4 v3 §4 п.1). Имя столбца "userId" — camelCase
-- в кавычках, подтверждено по фактическому DDL init-миграции.
CREATE UNIQUE INDEX "workouts_user_active_uq" ON "workouts"("userId") WHERE "status" = 'in_progress';
