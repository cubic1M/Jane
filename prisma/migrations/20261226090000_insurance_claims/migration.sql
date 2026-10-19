-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "kind" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "happened_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "carrier" TEXT,
    "claims_phone" TEXT,
    "claims_url" TEXT,
    "claim_number" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_claims_user_id_status_idx" ON "insurance_claims"("user_id", "status");

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "insurance_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

