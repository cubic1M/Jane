-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "encrypted_bytes" BYTEA NOT NULL,
    "provider" TEXT,
    "policy_type" TEXT,
    "coverage_summary" TEXT,
    "premium_cents" INTEGER,
    "premium_frequency" TEXT,
    "renewal_date" DATE,
    "warranty_ends_on" DATE,
    "purchase_date" DATE,
    "purchase_amount_cents" INTEGER,
    "extraction_source" TEXT NOT NULL DEFAULT 'none',
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_user_id_uploaded_at_idx" ON "documents"("user_id", "uploaded_at");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

