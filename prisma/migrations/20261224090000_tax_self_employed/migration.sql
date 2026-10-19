-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "business_miles" INTEGER,
ADD COLUMN     "business_miles_year" INTEGER,
ADD COLUMN     "home_office_sq_ft" INTEGER,
ADD COLUMN     "tax_payments" JSONB NOT NULL DEFAULT '[]';

