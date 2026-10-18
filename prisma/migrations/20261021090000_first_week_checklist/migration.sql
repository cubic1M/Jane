-- AlterTable
ALTER TABLE "users" ADD COLUMN     "checklist_dismissed_at" TIMESTAMPTZ(3),
ADD COLUMN     "checklist_progress" JSONB NOT NULL DEFAULT '{}';

