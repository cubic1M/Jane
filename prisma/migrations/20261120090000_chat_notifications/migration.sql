-- AlterTable
ALTER TABLE "jane_messages" ADD COLUMN     "notified_at" TIMESTAMPTZ(3),
ADD COLUMN     "notified_via" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "chat_notify_prefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "chat_reply_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reply_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_reply_links_token_hash_key" ON "chat_reply_links"("token_hash");

-- CreateIndex
CREATE INDEX "chat_reply_links_user_id_idx" ON "chat_reply_links"("user_id");

-- CreateIndex
CREATE INDEX "chat_reply_links_message_id_idx" ON "chat_reply_links"("message_id");

-- AddForeignKey
ALTER TABLE "chat_reply_links" ADD CONSTRAINT "chat_reply_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

