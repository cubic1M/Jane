-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "pay_as_of" DATE,
ADD COLUMN     "pay_federal_ytd_cents" INTEGER,
ADD COLUMN     "pay_gross_ytd_cents" INTEGER,
ADD COLUMN     "pay_pretax_ytd_cents" INTEGER,
ADD COLUMN     "pay_retirement_ytd_cents" INTEGER,
ADD COLUMN     "pay_state_ytd_cents" INTEGER;

