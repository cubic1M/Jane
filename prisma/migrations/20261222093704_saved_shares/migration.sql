-- CreateTable
CREATE TABLE "saved_shares" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "saved_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_shares_token_hash_key" ON "saved_shares"("token_hash");

-- CreateIndex
CREATE INDEX "saved_shares_user_id_idx" ON "saved_shares"("user_id");

-- AddForeignKey
ALTER TABLE "saved_shares" ADD CONSTRAINT "saved_shares_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

