-- A lease on the claims a run takes before it moves money: "releasing" on a transfer and "moving" on
-- a paycheck plan. Each gets a nullable end-of-hold time; a claim past it (or with none) is taken
-- over by the next run, where before a claim was never given up or always taken. Additive: new
-- nullable columns, no backfill, no index. A row that is "releasing" or "moving" now has none and
-- reads as past its end, which is how those claims behaved before. Safe for the code running now,
-- which does not read them. Both tables already have their row-level security
-- (scripts/rls-protect.mjs).
ALTER TABLE "money_transfers" ADD COLUMN "claim_expires_at" TIMESTAMPTZ(3);
ALTER TABLE "paycheck_plans" ADD COLUMN "claim_expires_at" TIMESTAMPTZ(3);
