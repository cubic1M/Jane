-- Which debts a stored payoff plan covers: their ids at the start (or at the last monthly check).
-- Additive and nullable, no backfill: a plan made before this has none, and keeps saying "the debts
-- in your plan". Safe for the code running now, which does not read it. The table already has its
-- row-level security (scripts/rls-protect.mjs).
ALTER TABLE "debt_plans" ADD COLUMN "debt_ids" JSONB;
