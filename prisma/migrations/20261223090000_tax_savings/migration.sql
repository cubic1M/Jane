-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "savings_dismissed" TEXT[] DEFAULT ARRAY[]::TEXT[];

