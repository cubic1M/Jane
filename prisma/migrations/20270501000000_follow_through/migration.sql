-- Follow-through on a Yes: nudges, a failed fix coming back, a Yes settled when it's no longer found.
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'follow_up';
ALTER TYPE "alert_type" ADD VALUE IF NOT EXISTS 'statement_due';

ALTER TABLE "suggestion_outcomes"
  ADD COLUMN "nudge_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_nudged_at" TIMESTAMPTZ(3),
  ADD COLUMN "failed_at" TIMESTAMPTZ(3),
  ADD COLUMN "comebacks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "comeback_at" TIMESTAMPTZ(3),
  ADD COLUMN "settled_at" TIMESTAMPTZ(3);
