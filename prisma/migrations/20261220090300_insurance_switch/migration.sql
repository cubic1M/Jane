-- AlterTable
ALTER TABLE "insurance_policies" ADD COLUMN     "action_id" TEXT,
ADD COLUMN     "policy_number" TEXT,
ADD COLUMN     "replaces_policy_id" TEXT,
ADD COLUMN     "starts_on" DATE;

