-- AlterTable
ALTER TABLE "users" ADD COLUMN     "calendar_created_at" TIMESTAMPTZ(3),
ADD COLUMN     "calendar_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_calendar_token_hash_key" ON "users"("calendar_token_hash");

