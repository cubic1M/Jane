-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "family_children" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "pays_over_half_home" BOOLEAN,
ADD COLUMN     "spouse_wages_cents" INTEGER,
ADD COLUMN     "student_half_time" BOOLEAN,
ADD COLUMN     "student_years_before" INTEGER;

