-- CreateTable
CREATE TABLE "plan_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "decision_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_links_token_hash_key" ON "plan_links"("token_hash");

-- CreateIndex
CREATE INDEX "plan_links_user_id_idx" ON "plan_links"("user_id");

-- AddForeignKey
ALTER TABLE "plan_links" ADD CONSTRAINT "plan_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TYPE "decision_source" ADD VALUE 'link';
