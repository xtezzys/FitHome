import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from './generated/index.js';

/**
 * Общие helper'ы экспериментов Шага 0.
 * Изоляция: любые БД создаются ТОЛЬКО в prisma/stage0/tmp — assertIsolated
 * отклоняет любой путь вне этого каталога, защита от затрагивания основной
 * базы (file:./dev.db) встроена в каждый скрипт.
 */

export const stage0Dir = path.dirname(fileURLToPath(import.meta.url));
export const tmpDir = path.join(stage0Dir, 'tmp');
export const backendDir = path.resolve(stage0Dir, '..', '..');

/** Гарантия изоляции: путь обязан лежать внутри prisma/stage0/tmp. */
export function assertIsolated(file: string): void {
  const rel = path.relative(tmpDir, file);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `ОТКАЗ: путь ${file} вне изолированного каталога ${tmpDir} — эксперимент прерван`,
    );
  }
}

/** Абсолютный file:-URL изолированной БД. */
export function dbUrl(name: string): string {
  const file = path.join(tmpDir, name);
  assertIsolated(file);
  return `file:${file}`;
}

/** Путь к файлу изолированной БД. */
export function dbFile(name: string): string {
  const file = path.join(tmpDir, name);
  assertIsolated(file);
  return file;
}

/** Новый клиент поверх указанной изолированной БД. */
export function newClient(url: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: url });
}

/** Удаляет временную БД (и WAL/SHM) и создаёт заново. */
export function freshDbFile(name: string): string {
  const file = dbFile(name);
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const p = file + suffix;
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  return file;
}

/** Начальное состояние пробы (аналог схемы ДО этапа 3) — дублирует 0001_init. */
export const INIT_STATEMENTS: string[] = [
  `CREATE TABLE "probe_exercises" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "muscle_groups" TEXT NOT NULL
  )`,
  `CREATE TABLE "probe_programs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE "probe_program_exercises" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "program_id" INTEGER NOT NULL,
    "exercise_id" INTEGER NOT NULL,
    "ord" INTEGER NOT NULL,
    "target_weight" REAL,
    CONSTRAINT "probe_program_exercises_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "probe_programs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "probe_program_exercises_exercise_id_fkey" FOREIGN KEY ("exercise_id") REFERENCES "probe_exercises" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE UNIQUE INDEX "probe_program_exercises_program_id_ord_key" ON "probe_program_exercises"("program_id", "ord")`,
  `CREATE TABLE "probe_decimals" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "val" REAL,
    "name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

/** Применяет начальную схему пооператорно. */
export async function initSchema(db: PrismaClient): Promise<void> {
  for (const statement of INIT_STATEMENTS) {
    await db.$executeRawUnsafe(statement);
  }
}

/**
 * DDL rebuild'а probe_exercises/probe_programs (аналог B) с «парковкой детей»:
 * дочерние строки выводятся до DROP родителя. Необходимо в обоих вариантах:
 * - интерактивный исполнитель: implicit DELETE при DROP записывает отложенные
 *   FK-нарушения, которые не сбрасываются UPDATE и роняют COMMIT (E-A);
 * - Prisma Migrate: немедленная FK-проверка роняет DROP при наличии детей (E-B).
 */
export const REBUILD_STATEMENTS: string[] = [
  'PRAGMA defer_foreign_keys=ON',
  `CREATE TABLE "_pe_park" (
    "id" INTEGER,
    "program_id" INTEGER,
    "exercise_id" INTEGER,
    "ord" INTEGER,
    "target_weight" REAL
  )`,
  `INSERT INTO "_pe_park" ("id", "program_id", "exercise_id", "ord", "target_weight")
   SELECT "id", "program_id", "exercise_id", "ord", "target_weight" FROM "probe_program_exercises"`,
  'DELETE FROM "probe_program_exercises"',
  `CREATE TABLE "_new_probe_exercises" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "name_lower" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "muscle_groups" TEXT NOT NULL
  )`,
  `INSERT INTO "_new_probe_exercises" ("id", "name", "name_lower", "difficulty", "muscle_groups")
   SELECT "id", "name", lower("name"), 'medium', "muscle_groups" FROM "probe_exercises"`,
  'DROP TABLE "probe_exercises"',
  'ALTER TABLE "_new_probe_exercises" RENAME TO "probe_exercises"',
  'CREATE INDEX "probe_exercises_name_lower_idx" ON "probe_exercises"("name_lower")',
  `CREATE TABLE "_new_probe_programs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT 1
  )`,
  `INSERT INTO "_new_probe_programs" ("id", "user_id", "name", "is_active")
   SELECT "id", "user_id", "name", "is_active" FROM "probe_programs"`,
  'DROP TABLE "probe_programs"',
  'ALTER TABLE "_new_probe_programs" RENAME TO "probe_programs"',
  `INSERT INTO "probe_program_exercises" ("id", "program_id", "exercise_id", "ord", "target_weight")
   SELECT "id", "program_id", "exercise_id", "ord", "target_weight" FROM "_pe_park"`,
  'DROP TABLE "_pe_park"',
];

export interface SeedInfo {
  exerciseIds: number[];
  readyProgramId: number;
  ownProgramId: number;
  peIds: number[];
}

/** Заполняет данные: ASCII- и кириллические имена, общая и своя программа, Decimal. */
export async function seed(db: PrismaClient): Promise<SeedInfo> {
  const names: Array<[string, string]> = [
    ['Отжимания', 'chest, triceps'],
    ['Приседания', 'quads'],
    ['Подтягивания', 'back'],
    ['Push-ups', 'chest'],
  ];
  const exerciseIds: number[] = [];
  for (const [name, muscleGroups] of names) {
    await db.$executeRawUnsafe(
      `INSERT INTO "probe_exercises" ("name", "muscle_groups") VALUES (?, ?)`,
      name,
      muscleGroups,
    );
  }
  const idRows = await db.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT "id" FROM "probe_exercises" ORDER BY "id"`,
  );
  for (const r of idRows) exerciseIds.push(r.id);

  // Общая программа (user_id NULL — аналог готовой) и «своя» (user_id = 1)
  await db.$executeRawUnsafe(
    `INSERT INTO "probe_programs" ("user_id", "name", "is_active") VALUES (NULL, 'Готовая базовая', 1)`,
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "probe_programs" ("user_id", "name", "is_active") VALUES (1, 'Своя программа', 1)`,
  );
  const programs = await db.$queryRawUnsafe<Array<{ id: number; user_id: number | null }>>(
    `SELECT "id", "user_id" FROM "probe_programs" ORDER BY "id"`,
  );
  const readyProgramId = programs[0].id;
  const ownProgramId = programs[1].id;

  const peIds: number[] = [];
  await db.$executeRawUnsafe(
    `INSERT INTO "probe_program_exercises" ("program_id", "exercise_id", "ord", "target_weight")
     VALUES (?, ?, 1, 40.5), (?, ?, 2, NULL)`,
    readyProgramId,
    exerciseIds[0],
    readyProgramId,
    exerciseIds[1],
  );
  await db.$executeRawUnsafe(
    `INSERT INTO "probe_program_exercises" ("program_id", "exercise_id", "ord", "target_weight")
     VALUES (?, ?, 1, 12.5)`,
    ownProgramId,
    exerciseIds[2],
  );
  const peRows = await db.$queryRawUnsafe<Array<{ id: number }>>(
    `SELECT "id" FROM "probe_program_exercises" ORDER BY "id"`,
  );
  for (const r of peRows) peIds.push(r.id);

  return { exerciseIds, readyProgramId, ownProgramId, peIds };
}

let failures = 0;

/** Проверка с мгновенным выводом; возвращает true при успехе. */
export function check(label: string, condition: boolean, details?: string): boolean {
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`    [${mark}] ${label}${details ? ` — ${details}` : ''}`);
  if (!condition) failures += 1;
  return condition;
}

export function summary(experiment: string): number {
  console.log(`\n=== ${experiment}: ${failures === 0 ? 'PASS (все проверки зелёные)' : `FAIL (провалено: ${failures})`} ===`);
  return failures === 0 ? 0 : 1;
}

export function resetChecks(): void {
  failures = 0;
}
