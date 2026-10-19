-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "keep_refund_year" INTEGER,
ADD COLUMN     "w4_amount_cents" INTEGER,
ADD COLUMN     "w4_changed_on" DATE,
ADD COLUMN     "w4_step" TEXT,
ADD COLUMN     "w4_year" INTEGER;

