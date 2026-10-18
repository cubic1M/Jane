-- AlterTable
ALTER TABLE "users" ADD COLUMN     "membership_offer_dismissed_at" TIMESTAMPTZ(3),
ADD COLUMN     "membership_offer_shown_at" TIMESTAMPTZ(3);
