-- CreateTable
CREATE TABLE "insurance_savings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offered',
    "yearly_saving_cents" INTEGER NOT NULL,
    "current_yearly_cents" INTEGER NOT NULL,
    "new_yearly_cents" INTEGER NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "confirmation" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(3),

    CONSTRAINT "insurance_savings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_savings_user_id_status_idx" ON "insurance_savings"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_savings_user_id_policy_id_kind_key" ON "insurance_savings"("user_id", "policy_id", "kind");

-- AddForeignKey
ALTER TABLE "insurance_savings" ADD CONSTRAINT "insurance_savings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
