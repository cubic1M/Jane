-- CreateEnum
CREATE TYPE "data_source" AS ENUM ('csv', 'plaid');

-- CreateEnum
CREATE TYPE "category_source" AS ENUM ('rule', 'llm', 'plaid');

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_item_id_fkey";

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "source" "data_source" NOT NULL,
ALTER COLUMN "item_id" DROP NOT NULL,
ALTER COLUMN "plaid_account_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "category_source" "category_source",
ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "description" TEXT NOT NULL,
ADD COLUMN     "source" "data_source" NOT NULL,
ALTER COLUMN "plaid_transaction_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "merchant_categories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant_key" TEXT NOT NULL,
    "pfc_primary" TEXT NOT NULL,
    "pfc_detailed" TEXT NOT NULL,
    "source" "category_source" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merchant_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_categories_user_id_idx" ON "merchant_categories"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_categories_user_id_merchant_key_key" ON "merchant_categories"("user_id", "merchant_key");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_dedupe_key_key" ON "transactions"("account_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "plaid_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_categories" ADD CONSTRAINT "merchant_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
