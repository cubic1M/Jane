-- What people point out on their tax calculation: income that isn't, a deduction, a payment, a
-- number that's wrong. Row-level security reaches it by its user_id (docs/security/rls.md).
CREATE TABLE "tax_corrections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "payer_key" TEXT,
    "label" TEXT NOT NULL,
    "cents" INTEGER,
    "paid_to" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_corrections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_tax_corrections_cents_not_negative" CHECK ("cents" IS NULL OR "cents" >= 0)
);

CREATE INDEX "tax_corrections_user_id_year_idx" ON "tax_corrections"("user_id", "year");
CREATE UNIQUE INDEX "tax_corrections_user_id_year_kind_payer_key_key" ON "tax_corrections"("user_id", "year", "kind", "payer_key");

ALTER TABLE "tax_corrections" ADD CONSTRAINT "tax_corrections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
