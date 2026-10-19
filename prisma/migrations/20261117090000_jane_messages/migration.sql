-- AlterEnum
ALTER TYPE "decision_source" ADD VALUE 'chat';

-- CreateTable
CREATE TABLE "jane_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "refs" JSONB NOT NULL DEFAULT '{}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "answered_with" TEXT,
    "answered_at" TIMESTAMPTZ(3),
    "dedupe_key" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jane_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jane_messages_user_id_created_at_idx" ON "jane_messages"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "jane_messages_user_id_dedupe_key_key" ON "jane_messages"("user_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "jane_messages" ADD CONSTRAINT "jane_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

