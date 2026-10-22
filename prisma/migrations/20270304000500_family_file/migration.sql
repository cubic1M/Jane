-- CreateTable
CREATE TABLE "account_beneficiaries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "share_pct" INTEGER NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'primary',
    "confirmed_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    "picks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contacts" JSONB NOT NULL DEFAULT '[]',
    "documents" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_beneficiaries_user_id_idx" ON "account_beneficiaries"("user_id");

-- CreateIndex
CREATE INDEX "account_beneficiaries_account_id_idx" ON "account_beneficiaries"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_files_user_id_key" ON "family_files"("user_id");

-- AddForeignKey
ALTER TABLE "account_beneficiaries" ADD CONSTRAINT "account_beneficiaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_beneficiaries" ADD CONSTRAINT "account_beneficiaries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_files" ADD CONSTRAINT "family_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
