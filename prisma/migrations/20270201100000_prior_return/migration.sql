-- CreateTable
CREATE TABLE "prior_returns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "notes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "prior_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_amendments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "partner" TEXT NOT NULL,
    "partner_return_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "refund_cents" INTEGER NOT NULL,
    "signer_name" TEXT,
    "signed_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prior_returns_document_id_key" ON "prior_returns"("document_id");

-- CreateIndex
CREATE INDEX "prior_returns_user_id_idx" ON "prior_returns"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_amendments_user_id_year_key" ON "tax_amendments"("user_id", "year");

-- AddForeignKey
ALTER TABLE "prior_returns" ADD CONSTRAINT "prior_returns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prior_returns" ADD CONSTRAINT "prior_returns_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_amendments" ADD CONSTRAINT "tax_amendments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

