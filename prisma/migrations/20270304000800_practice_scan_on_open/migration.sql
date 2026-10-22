-- Constant search (Phase AW, Stage A): when the cheap on-open practice scan last ran.
ALTER TABLE "practice_portfolios" ADD COLUMN "light_scanned_at" TIMESTAMPTZ(3);
