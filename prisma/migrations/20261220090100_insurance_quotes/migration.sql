-- CreateTable
CREATE TABLE "insurance_quotes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "partner_quote_id" TEXT NOT NULL,
    "carrier_id" TEXT NOT NULL,
    "carrier_name" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "rating_score" INTEGER NOT NULL,
    "claims_phone" TEXT NOT NULL,
    "claims_url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "premium_cents" INTEGER NOT NULL,
    "premium_frequency" TEXT NOT NULL,
    "annual_premium_cents" INTEGER NOT NULL,
    "term_months" INTEGER NOT NULL,
    "deductible_cents" INTEGER,
    "coverage" JSONB NOT NULL DEFAULT '{}',
    "same_cover" BOOLEAN NOT NULL,
    "differences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "demo" BOOLEAN NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_quotes_user_id_policy_id_idx" ON "insurance_quotes"("user_id", "policy_id");

-- AddForeignKey
ALTER TABLE "insurance_quotes" ADD CONSTRAINT "insurance_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_quotes" ADD CONSTRAINT "insurance_quotes_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

