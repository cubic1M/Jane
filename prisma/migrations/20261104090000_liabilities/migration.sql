-- AlterTable
ALTER TABLE "plaid_items" ADD COLUMN     "liabilities" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "liabilities" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "apr_bps" INTEGER,
    "rate_type" TEXT,
    "minimum_payment_cents" INTEGER,
    "next_payment_due_date" DATE,
    "last_payment_cents" INTEGER,
    "last_payment_date" DATE,
    "origination_principal_cents" INTEGER,
    "origination_date" DATE,
    "payoff_date" DATE,
    "is_overdue" BOOLEAN,
    "past_due_cents" INTEGER,
    "ytd_interest_paid_cents" INTEGER,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "liabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "liabilities_account_id_key" ON "liabilities"("account_id");

-- CreateIndex
CREATE INDEX "liabilities_user_id_idx" ON "liabilities"("user_id");

-- AddForeignKey
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

