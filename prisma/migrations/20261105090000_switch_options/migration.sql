-- CreateTable
CREATE TABLE "switch_options" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT,
    "merchant_key" TEXT,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_cents" INTEGER,
    "apy_bps" INTEGER,
    "contract_months" INTEGER NOT NULL DEFAULT 0,
    "one_time_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "minimum_balance_cents" INTEGER NOT NULL DEFAULT 0,
    "includes" TEXT,
    "gives_up" TEXT,
    "sign_up_url" TEXT,
    "source_url" TEXT NOT NULL,
    "checked_at" DATE NOT NULL,
    "reviewed_at" TIMESTAMPTZ(3),
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "switch_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "switch_options_kind_category_idx" ON "switch_options"("kind", "category");

-- CreateIndex
CREATE INDEX "switch_options_merchant_key_idx" ON "switch_options"("merchant_key");

