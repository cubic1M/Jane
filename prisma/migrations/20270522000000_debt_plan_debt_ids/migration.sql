-- Which debts a stored payoff plan covers: their ids at the start (or at the last monthly check),
-- and the ids the last check left out because they came after the plan (so its message can name
-- them). Additive and nullable, no backfill: a plan made before this has neither, and keeps saying
-- "the debts in your plan". Safe for the code running now, which does not read them. The table
-- already has its row-level security (scripts/rls-protect.mjs).
ALTER TABLE "debt_plans" ADD COLUMN "debt_ids" JSONB;
ALTER TABLE "debt_plans" ADD COLUMN "check_excluded_ids" JSONB;
