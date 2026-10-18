-- AlterTable
ALTER TABLE "actions" ADD COLUMN     "user_todo" TEXT;

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "undone_at" TIMESTAMPTZ(3);
