-- Этап 6: перерыв между подходами в составе программы.
-- ProgramExercise.restSec — секунды отдыха между подходами (0 — без перерыва).
-- Существующие строки получают значение по умолчанию 90 секунд.

ALTER TABLE "program_exercises" ADD COLUMN "restSec" INTEGER NOT NULL DEFAULT 90;
