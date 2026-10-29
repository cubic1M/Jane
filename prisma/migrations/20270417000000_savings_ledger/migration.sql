-- The savings ledger: Held and lapsed on suggestion outcomes, Verified and Held on actions.
ALTER TABLE "suggestion_outcomes" ADD COLUMN "held_at" TIMESTAMPTZ(3),
ADD COLUMN "lapsed_at" TIMESTAMPTZ(3),
ADD COLUMN "held_proof" TEXT,
ADD COLUMN "held_evidence_tx_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "actions" ADD COLUMN "saving_verified_at" TIMESTAMPTZ(3),
ADD COLUMN "saving_held_at" TIMESTAMPTZ(3);
