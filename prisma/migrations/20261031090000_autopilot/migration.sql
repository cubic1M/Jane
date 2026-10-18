-- CreateEnum
CREATE TYPE "autopilot_level" AS ENUM ('ask', 'safe', 'all', 'custom');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "autopilot" "autopilot_level";

