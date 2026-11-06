-- How each referral partner pays Jane, and the insurance lines it compares (src/lib/referrals.ts,
-- connectors roadmap round 14). Every existing partner is unpaid by default.
ALTER TABLE "referral_partners" ADD COLUMN "pay_model" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "referral_partners" ADD COLUMN "lines" TEXT[] DEFAULT ARRAY[]::TEXT[];
