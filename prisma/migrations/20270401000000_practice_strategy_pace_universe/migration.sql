-- The practice portfolio's strategy, rebalance pace, what may be bought and the most in one fund
-- (Phase AW, Stage A). Existing rows keep today's behaviour through the defaults.
ALTER TABLE "practice_preferences" ADD COLUMN "strategy" TEXT NOT NULL DEFAULT 'level';
ALTER TABLE "practice_preferences" ADD COLUMN "rebalance_pace" TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE "practice_preferences" ADD COLUMN "universe" TEXT NOT NULL DEFAULT 'funds_and_stocks';
ALTER TABLE "practice_preferences" ADD COLUMN "max_fund_percent" INTEGER;
