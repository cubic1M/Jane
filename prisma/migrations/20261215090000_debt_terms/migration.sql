-- CreateTable
CREATE TABLE "debt_terms" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "debt_key" TEXT NOT NULL,
    "apr_bps" INTEGER,
    "minimum_payment_cents" INTEGER,
    "balance_cents" INTEGER,
    "payoff_date" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "debt_terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "debt_terms_user_id_debt_key_key" ON "debt_terms"("user_id", "debt_key");

-- AddForeignKey
ALTER TABLE "debt_terms" ADD CONSTRAINT "debt_terms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

