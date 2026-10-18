-- CreateTable
CREATE TABLE "owned_assets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value_cents" INTEGER NOT NULL,
    "valued_on" DATE NOT NULL,
    "loan_account_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "owned_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owned_assets_user_id_idx" ON "owned_assets"("user_id");

-- AddForeignKey
ALTER TABLE "owned_assets" ADD CONSTRAINT "owned_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owned_assets" ADD CONSTRAINT "owned_assets_loan_account_id_fkey" FOREIGN KEY ("loan_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

