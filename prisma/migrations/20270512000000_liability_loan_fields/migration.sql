-- AlterTable
ALTER TABLE "liabilities" ADD COLUMN     "loan_status" TEXT,
ADD COLUMN     "loan_status_end_date" DATE,
ADD COLUMN     "loan_term_months" INTEGER,
ADD COLUMN     "outstanding_interest_cents" INTEGER,
ADD COLUMN     "payment_count" INTEGER,
ADD COLUMN     "payoff_amount_cents" INTEGER,
ADD COLUMN     "principal_balance_cents" INTEGER,
ADD COLUMN     "repayment_plan" TEXT;
