-- CreateTable
CREATE TABLE "shared_charges" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "payer_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "partner_share_bps" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shared_charges_transaction_id_key" ON "shared_charges"("transaction_id");

-- CreateIndex
CREATE INDEX "shared_charges_household_id_idx" ON "shared_charges"("household_id");

-- CreateIndex
CREATE INDEX "settlements_household_id_idx" ON "settlements"("household_id");

-- AddForeignKey
ALTER TABLE "shared_charges" ADD CONSTRAINT "shared_charges_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

