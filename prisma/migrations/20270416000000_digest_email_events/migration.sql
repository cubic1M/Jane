-- The weekly "what changed" email: Resend's id for each one sent, so its open event (Resend's
-- webhook, when open tracking is on for the domain) can be matched back, and when it was first
-- opened. opened_at stays the first click on one of its links (/api/digest/click).
ALTER TABLE "digests" ADD COLUMN "resend_id" TEXT;
ALTER TABLE "digests" ADD COLUMN "email_opened_at" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "digests_resend_id_key" ON "digests"("resend_id");
