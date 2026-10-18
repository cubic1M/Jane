-- AlterEnum
ALTER TYPE "decision_choice" ADD VALUE 'diy';

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "diy_done_at" TIMESTAMPTZ(3);

