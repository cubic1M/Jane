-- CreateTable
CREATE TABLE "loan_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "debt_key" TEXT NOT NULL,
    "old_account_id" TEXT,
    "old_name" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "apr_bps" INTEGER NOT NULL,
    "rate_type" TEXT NOT NULL,
    "term_months" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "fee_cents" INTEGER NOT NULL,
    "monthly_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "saving_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "applicant" JSONB NOT NULL DEFAULT '{}',
    "partner_application_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "funded_at" TIMESTAMPTZ(3),
    "paid_off_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_applications_user_id_idx" ON "loan_applications"("user_id");

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

