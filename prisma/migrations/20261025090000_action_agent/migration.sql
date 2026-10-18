-- CreateEnum
CREATE TYPE "agent_state" AS ENUM ('working', 'waiting_reply', 'handed_off', 'finished');

-- CreateEnum
CREATE TYPE "agent_direction" AS ENUM ('outbound', 'inbound');

-- AlterTable
ALTER TABLE "actions" ADD COLUMN     "agent_follow_ups" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "agent_next_at" TIMESTAMPTZ(3),
ADD COLUMN     "agent_state" "agent_state",
ADD COLUMN     "handoff_reason" TEXT,
ADD COLUMN     "reply_token" TEXT;

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "support_email" TEXT;

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "direction" "agent_direction" NOT NULL,
    "to_address" TEXT NOT NULL,
    "from_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "outcome" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_messages_action_id_created_at_idx" ON "agent_messages"("action_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_messages_user_id_idx" ON "agent_messages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "actions_reply_token_key" ON "actions"("reply_token");

-- CreateIndex
CREATE INDEX "actions_agent_state_agent_next_at_idx" ON "actions"("agent_state", "agent_next_at");

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

