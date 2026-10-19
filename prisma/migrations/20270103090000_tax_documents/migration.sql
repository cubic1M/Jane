-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "documents_checked_on" DATE;

-- CreateTable
CREATE TABLE "tax_documents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "form_key" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "boxes" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "decision" TEXT,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "tax_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_documents_user_id_year_key_key" ON "tax_documents"("user_id", "year", "key");

-- AddForeignKey
ALTER TABLE "tax_documents" ADD CONSTRAINT "tax_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

