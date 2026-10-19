-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL,
    "premium_cents" INTEGER,
    "premium_frequency" TEXT,
    "deductible_cents" INTEGER,
    "coverage" JSONB NOT NULL DEFAULT '{}',
    "covers" TEXT,
    "renewal_date" DATE,
    "term_months" INTEGER NOT NULL DEFAULT 12,
    "document_id" TEXT,
    "merchant_key" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_profiles" (
    "user_id" TEXT NOT NULL,
    "housing" TEXT,
    "vehicles" INTEGER,
    "dependants" INTEGER,
    "pets" INTEGER,
    "dismissed_gaps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "insurance_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insurance_policies_document_id_key" ON "insurance_policies"("document_id");

-- CreateIndex
CREATE INDEX "insurance_policies_user_id_status_idx" ON "insurance_policies"("user_id", "status");

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_profiles" ADD CONSTRAINT "insurance_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

