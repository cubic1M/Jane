-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "plan_handled" TEXT[] DEFAULT ARRAY[]::TEXT[];

