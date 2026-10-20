-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "retention_reminded" TEXT[] DEFAULT ARRAY[]::TEXT[];

