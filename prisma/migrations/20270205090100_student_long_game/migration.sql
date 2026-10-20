-- AlterTable
ALTER TABLE "student_loan_profiles" ADD COLUMN     "certify_deadline_id" TEXT,
ADD COLUMN     "last_certified_on" DATE,
ADD COLUMN     "loan_type" TEXT NOT NULL DEFAULT 'federal',
ADD COLUMN     "recertify_deadline_id" TEXT,
ADD COLUMN     "recertify_on" DATE,
ADD COLUMN     "tax_deadline_id" TEXT;

