-- AlterTable
ALTER TABLE "paper_event_overlays" ALTER COLUMN "on" SET DEFAULT true;

-- CreateTable
CREATE TABLE "refresh_locks" (
    "key" TEXT NOT NULL,
    "locked_until" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "report" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "refresh_locks_pkey" PRIMARY KEY ("key")
);

