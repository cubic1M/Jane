-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "donor_fund_name" TEXT,
ADD COLUMN     "donor_fund_opened_at" TIMESTAMPTZ(3),
ADD COLUMN     "donor_fund_partner" TEXT,
ADD COLUMN     "giving_dismissed_year" INTEGER,
ADD COLUMN     "giving_receipts" TEXT[] DEFAULT ARRAY[]::TEXT[];

