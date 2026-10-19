-- AlterTable
ALTER TABLE "refinance_checks" ADD COLUMN     "transfers" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "balance_transfers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_debt_key" TEXT NOT NULL,
    "from_name" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "card_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "fee_cents" INTEGER NOT NULL,
    "promo_months" INTEGER NOT NULL,
    "go_to_apr_bps" INTEGER NOT NULL,
    "monthly_needed_cents" INTEGER NOT NULL,
    "started_on" DATE NOT NULL,
    "promo_ends_on" DATE NOT NULL,
    "deadline_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "done_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "balance_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "balance_transfers_user_id_idx" ON "balance_transfers"("user_id");

-- AddForeignKey
ALTER TABLE "balance_transfers" ADD CONSTRAINT "balance_transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

