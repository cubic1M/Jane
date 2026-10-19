-- CreateTable
CREATE TABLE "insurance_shops" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "current_annual_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "pick" JSONB,
    "runners_up" JSONB NOT NULL DEFAULT '[]',
    "saving_cents" INTEGER,
    "why" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quote_count" INTEGER NOT NULL,
    "demo" BOOLEAN NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "answered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_shops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_shops_user_id_status_idx" ON "insurance_shops"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_shops_user_id_key_key" ON "insurance_shops"("user_id", "key");

-- AddForeignKey
ALTER TABLE "insurance_shops" ADD CONSTRAINT "insurance_shops_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_shops" ADD CONSTRAINT "insurance_shops_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "insurance_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

