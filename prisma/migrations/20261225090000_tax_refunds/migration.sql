-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "refunds_handled" TEXT[] DEFAULT ARRAY[]::TEXT[];

