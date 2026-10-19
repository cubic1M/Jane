-- AlterTable
ALTER TABLE "liabilities" ADD COLUMN     "escrow_balance_cents" INTEGER,
ADD COLUMN     "has_pmi" BOOLEAN,
ADD COLUMN     "has_prepayment_penalty" BOOLEAN;

