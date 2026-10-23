-- CreateTable
CREATE TABLE "family_credit_help" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "person" TEXT NOT NULL,
    "debt_key" TEXT,
    "balance_cents" INTEGER,
    "monthly_payment_cents" INTEGER,
    "missed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_credit_help_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "family_credit_help_user_id_idx" ON "family_credit_help"("user_id");

-- AddForeignKey
ALTER TABLE "family_credit_help" ADD CONSTRAINT "family_credit_help_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
