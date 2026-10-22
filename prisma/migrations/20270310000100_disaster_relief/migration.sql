-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "disaster_applied" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "disaster_losses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "relief_id" TEXT NOT NULL,
    "claim_id" TEXT,
    "tax_year" INTEGER NOT NULL,
    "loss_cents" INTEGER NOT NULL,
    "reimbursed_cents" INTEGER NOT NULL,
    "deductible_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disaster_losses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disaster_losses_user_id_key_key" ON "disaster_losses"("user_id", "key");

-- AddForeignKey
ALTER TABLE "disaster_losses" ADD CONSTRAINT "disaster_losses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disaster_losses" ADD CONSTRAINT "disaster_losses_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "insurance_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

