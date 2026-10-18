-- CreateTable
CREATE TABLE "ask_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ask_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ask_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ask_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ask_conversations_user_id_updated_at_idx" ON "ask_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "ask_messages_conversation_id_created_at_idx" ON "ask_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ask_messages_user_id_idx" ON "ask_messages"("user_id");

-- AddForeignKey
ALTER TABLE "ask_conversations" ADD CONSTRAINT "ask_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_messages" ADD CONSTRAINT "ask_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ask_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

