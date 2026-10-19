-- CreateTable
CREATE TABLE "tax_returns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "partner" TEXT NOT NULL,
    "partner_return_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "package" JSONB NOT NULL,
    "preview" JSONB NOT NULL,
    "signer_name" TEXT,
    "signed_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_returns_user_id_year_key" ON "tax_returns"("user_id", "year");

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

