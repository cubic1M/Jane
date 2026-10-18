-- AlterEnum
ALTER TYPE "agent_state" ADD VALUE 'confirming';

-- AlterEnum
ALTER TYPE "decision_source" ADD VALUE 'auto';

-- AlterTable
ALTER TABLE "actions" ADD COLUMN     "cancelled_on" DATE,
ADD COLUMN     "confirm_after" DATE;

ALTER TABLE "actions" ADD COLUMN     "self_service_url" TEXT;

