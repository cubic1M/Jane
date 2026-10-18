-- DropIndex (the new unique index on user_id, type, key covers lookups by user)
DROP INDEX "findings_user_id_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "first_detection_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "recurring_streams" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pfc_detailed" TEXT,
ADD COLUMN     "pfc_primary" TEXT,
ADD COLUMN     "transaction_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable: findings made before detection existed get their own id as key, so the
-- column can be required and no two old rows collide on the new unique index.
ALTER TABLE "findings" ADD COLUMN     "amount_cents" INTEGER,
ADD COLUMN     "key" TEXT;
UPDATE "findings" SET "key" = "id" WHERE "key" IS NULL;
ALTER TABLE "findings" ALTER COLUMN "key" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "findings_user_id_type_key_key" ON "findings"("user_id", "type", "key");

-- Plaid PFCv2 renamed three v1 categories; move stored rows to the new names.
UPDATE "transactions" SET "pfc_primary" = 'INCOME', "pfc_detailed" = 'INCOME_SALARY'
  WHERE "pfc_detailed" = 'INCOME_WAGES';
UPDATE "transactions" SET "pfc_primary" = 'INCOME', "pfc_detailed" = 'INCOME_OTHER'
  WHERE "pfc_detailed" = 'INCOME_OTHER_INCOME';
UPDATE "transactions" SET "pfc_primary" = 'LOAN_DISBURSEMENTS', "pfc_detailed" = 'LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT'
  WHERE "pfc_detailed" = 'TRANSFER_IN_CASH_ADVANCES_AND_LOANS';
UPDATE "merchant_categories" SET "pfc_primary" = 'INCOME', "pfc_detailed" = 'INCOME_SALARY'
  WHERE "pfc_detailed" = 'INCOME_WAGES';
UPDATE "merchant_categories" SET "pfc_primary" = 'INCOME', "pfc_detailed" = 'INCOME_OTHER'
  WHERE "pfc_detailed" = 'INCOME_OTHER_INCOME';
UPDATE "merchant_categories" SET "pfc_primary" = 'LOAN_DISBURSEMENTS', "pfc_detailed" = 'LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT'
  WHERE "pfc_detailed" = 'TRANSFER_IN_CASH_ADVANCES_AND_LOANS';
