-- Who put a deposit where it is, for the passes that sort deposits as income: a nullable text on
-- transactions. "inferred" is income the regular-payers pass placed, "declined" is the person's "not
-- income" for cash deposits, "edited" is a category they set by hand. Additive: a new nullable column,
-- no backfill, no index. Every row that exists keeps null, which the code reads as before (a deposit
-- the person owns with no marker is still their "not income"; income placed with no marker is still
-- left as it is). Safe for the code running now, which does not read it. The table already has its
-- row-level security (scripts/rls-protect.mjs).
ALTER TABLE "transactions" ADD COLUMN "income_placement" TEXT;
