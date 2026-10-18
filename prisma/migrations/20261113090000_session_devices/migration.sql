-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "last_seen_at" TIMESTAMPTZ(3),
ADD COLUMN     "user_agent" TEXT;

