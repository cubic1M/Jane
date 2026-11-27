-- Two additive columns, no backfill, safe for the code running now (it does not read them):
--  actions.revision: counts the team's saves, so two admins saving from the same screen cannot
--    silently overwrite each other (the second save is refused with a plain message).
--  monthly_reports.claimed_at: when a run took the report to email it, so a run that stopped between
--    the claim and the send is taken over after a time limit instead of the report being lost.
-- Both tables already have their row-level security (scripts/rls-protect.mjs).
ALTER TABLE "actions" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "monthly_reports" ADD COLUMN "claimed_at" TIMESTAMPTZ(3);
