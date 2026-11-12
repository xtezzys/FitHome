-- Этап 3, миграция A: nullable-колонки для упражнений.
-- nameLower/difficulty заполняются JS-backfill'ом (prisma/backfill-stage3.ts)
-- ДО применения миграции B (rebuild с NOT NULL) — см. docs/database.md §9
-- и docs/stage0-experiments.md.
--
-- ВАЖНО: на БД с данными не запускайте голый `prisma migrate deploy`, пока
-- backfill не выполнен — миграция B защищена NOT NULL-guard'ом и упадёт
-- безопасно; используйте оркестратор `npm run stage3:migrate`.

ALTER TABLE "exercises" ADD COLUMN "nameLower" TEXT;
ALTER TABLE "exercises" ADD COLUMN "difficulty" TEXT;
ALTER TABLE "exercises" ADD COLUMN "equipment" TEXT;
