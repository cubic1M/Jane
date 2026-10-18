-- CreateEnum
CREATE TYPE "decision_source" AS ENUM ('card', 'plan', 'rule');

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "options" JSONB,
ADD COLUMN     "source" "decision_source" NOT NULL DEFAULT 'card';

