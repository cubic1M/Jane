-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "locality" TEXT,
ADD COLUMN     "moves" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "residency_year" INTEGER,
ADD COLUMN     "work_state" TEXT;
