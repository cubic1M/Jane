-- CreateTable
CREATE TABLE "tax_notices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "notes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "response" TEXT,
    "draft" TEXT,
    "handled_by" TEXT,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_notices_document_id_key" ON "tax_notices"("document_id");

-- CreateIndex
CREATE INDEX "tax_notices_user_id_idx" ON "tax_notices"("user_id");

-- AddForeignKey
ALTER TABLE "tax_notices" ADD CONSTRAINT "tax_notices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_notices" ADD CONSTRAINT "tax_notices_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

