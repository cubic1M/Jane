-- AlterEnum
ALTER TYPE "finding_type" ADD VALUE 'low_balance_risk';

-- AlterEnum
ALTER TYPE "action_type" ADD VALUE 'review_cash_flow';

-- AlterTable
ALTER TABLE "recurring_streams" ADD COLUMN     "predicted_next_date" DATE;
