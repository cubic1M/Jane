-- AlterTable
ALTER TABLE "insurance_policies" ADD COLUMN     "covered" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "shared_with_household" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "insurance_profiles" ADD COLUMN     "people" JSONB NOT NULL DEFAULT '[]';
