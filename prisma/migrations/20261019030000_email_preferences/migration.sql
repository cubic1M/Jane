-- AlterTable
ALTER TABLE "users" ADD COLUMN     "digest_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "timezone" TEXT;
