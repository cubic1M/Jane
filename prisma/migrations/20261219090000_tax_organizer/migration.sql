
-- CreateTable
CREATE TABLE "tax_tags" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "merchant_key" TEXT,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_forms" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_tags_user_id_idx" ON "tax_tags"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_tags_user_id_transaction_id_key" ON "tax_tags"("user_id", "transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_tags_user_id_merchant_key_key" ON "tax_tags"("user_id", "merchant_key");

-- CreateIndex
CREATE UNIQUE INDEX "tax_forms_user_id_year_key_key" ON "tax_forms"("user_id", "year", "key");

-- AddForeignKey
ALTER TABLE "tax_tags" ADD CONSTRAINT "tax_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_tags" ADD CONSTRAINT "tax_tags_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_forms" ADD CONSTRAINT "tax_forms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

