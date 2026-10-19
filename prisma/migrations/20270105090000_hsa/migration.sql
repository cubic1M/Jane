-- AlterTable
ALTER TABLE "plaid_items" ADD COLUMN     "demo_extras" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "hsa_receipts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "merchant" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'saved',
    "reimbursed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hsa_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hsa_receipts_transaction_id_key" ON "hsa_receipts"("transaction_id");

-- CreateIndex
CREATE INDEX "hsa_receipts_user_id_date_idx" ON "hsa_receipts"("user_id", "date");

-- AddForeignKey
ALTER TABLE "hsa_receipts" ADD CONSTRAINT "hsa_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hsa_receipts" ADD CONSTRAINT "hsa_receipts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

