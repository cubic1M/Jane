-- AlterTable
ALTER TABLE "suggestions" ADD COLUMN     "watch" JSONB;

-- CreateTable
CREATE TABLE "suggestion_outcomes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "suggestion_key" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "first_shown_at" TIMESTAMPTZ(3) NOT NULL,
    "last_shown_at" TIMESTAMPTZ(3) NOT NULL,
    "times_shown" INTEGER NOT NULL DEFAULT 1,
    "opened_at" TIMESTAMPTZ(3),
    "answer" TEXT,
    "answered_at" TIMESTAMPTZ(3),
    "done_at" TIMESTAMPTZ(3),
    "expected_cents" INTEGER NOT NULL,
    "worth_kind" TEXT NOT NULL,
    "confidence_percent" INTEGER NOT NULL,
    "watch" JSONB,
    "status" TEXT NOT NULL DEFAULT 'shown',
    "confirmed_cents" INTEGER,
    "yearly" BOOLEAN NOT NULL DEFAULT true,
    "verified_percent" INTEGER,
    "evidence_tx_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proof" TEXT,
    "checked_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestion_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestion_outcomes_user_id_status_idx" ON "suggestion_outcomes"("user_id", "status");

-- CreateIndex
CREATE INDEX "suggestion_outcomes_topic_status_idx" ON "suggestion_outcomes"("topic", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suggestion_outcomes_user_id_suggestion_key_key" ON "suggestion_outcomes"("user_id", "suggestion_key");

-- AddForeignKey
ALTER TABLE "suggestion_outcomes" ADD CONSTRAINT "suggestion_outcomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

