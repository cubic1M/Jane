-- AlterTable
ALTER TABLE "plaid_items" ADD COLUMN     "reconnect_by" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "invite_codes" ADD COLUMN     "emailed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "problem_reports" ADD COLUMN     "screenshot_encrypted" BYTEA,
ADD COLUMN     "screenshot_type" TEXT;

-- CreateTable
CREATE TABLE "ops_events" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ops_events_kind_created_at_idx" ON "ops_events"("kind", "created_at");

-- CreateIndex
CREATE INDEX "ops_events_created_at_idx" ON "ops_events"("created_at");

