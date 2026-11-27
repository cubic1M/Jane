-- One transfer for one move of a plan: a nullable key and a unique index over it per person, so a
-- plan that is tried twice (a retry, two taps at once) cannot schedule the same transfer twice.
-- Additive: the column is new and null on every existing row, and Postgres treats nulls as distinct,
-- so the index cannot fail on rows that exist now. Safe for the code running now, which does not
-- read or write it. The table already has its row-level security (scripts/rls-protect.mjs).
ALTER TABLE "money_transfers" ADD COLUMN "unique_key" TEXT;
CREATE UNIQUE INDEX "money_transfers_user_id_unique_key_key" ON "money_transfers"("user_id", "unique_key");
