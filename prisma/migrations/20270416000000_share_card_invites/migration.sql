-- A beta user's own share link (the result card): one invite code per person, with the card
-- it shows (a rounded yearly total or a check count, nothing else about them).
ALTER TABLE "invite_codes" ADD COLUMN "shared_by_id" TEXT;
ALTER TABLE "invite_codes" ADD COLUMN "card_kind" TEXT;
ALTER TABLE "invite_codes" ADD COLUMN "card_value" INTEGER;

CREATE UNIQUE INDEX "invite_codes_shared_by_id_key" ON "invite_codes"("shared_by_id");
