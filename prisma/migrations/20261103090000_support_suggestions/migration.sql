-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "suggested_at" TIMESTAMPTZ(3),
ADD COLUMN     "suggested_support_email" TEXT,
ADD COLUMN     "suggested_support_source" TEXT;

