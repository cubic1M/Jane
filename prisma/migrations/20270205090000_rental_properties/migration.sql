-- CreateTable
CREATE TABLE "rental_properties" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purchase_cents" INTEGER NOT NULL,
    "land_share" DOUBLE PRECISION NOT NULL,
    "placed_in_service_year" INTEGER NOT NULL,
    "placed_in_service_month" INTEGER NOT NULL,
    "cash_invested_cents" INTEGER NOT NULL,
    "loan_balance_cents" INTEGER NOT NULL DEFAULT 0,
    "loan_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "monthly_payment_cents" INTEGER NOT NULL DEFAULT 0,
    "rent_match" TEXT NOT NULL,
    "mortgage_match" TEXT NOT NULL DEFAULT '',
    "tax_match" TEXT NOT NULL DEFAULT '',
    "expense_match" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'you',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_properties_user_id_idx" ON "rental_properties"("user_id");

-- AddForeignKey
ALTER TABLE "rental_properties" ADD CONSTRAINT "rental_properties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

