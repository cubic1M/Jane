-- AlterTable
ALTER TABLE "insurance_claims" ADD COLUMN     "amount_cents" INTEGER,
ADD COLUMN     "carrier_status" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "filed_at" TIMESTAMPTZ(3),
ADD COLUMN     "filing" TEXT,
ADD COLUMN     "payout_cents" INTEGER;

-- CreateTable
CREATE TABLE "renewal_negotiations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "current_annual_cents" INTEGER NOT NULL,
    "renewal_annual_cents" INTEGER NOT NULL,
    "competing_annual_cents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'asked',
    "result_annual_cents" INTEGER,
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "offer" TEXT,
    "called_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMPTZ(3),

    CONSTRAINT "renewal_negotiations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "renewal_negotiations_user_id_status_idx" ON "renewal_negotiations"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "renewal_negotiations_user_id_key_key" ON "renewal_negotiations"("user_id", "key");

-- AddForeignKey
ALTER TABLE "renewal_negotiations" ADD CONSTRAINT "renewal_negotiations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
