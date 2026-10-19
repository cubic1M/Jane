-- CreateTable
CREATE TABLE "cover_changes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "policy_id" TEXT,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'prepared',
    "new_premium_cents" INTEGER,
    "confirmation" TEXT,
    "done_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMPTZ(3),

    CONSTRAINT "cover_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cover_changes_user_id_status_idx" ON "cover_changes"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cover_changes_user_id_event_event_key_change_key" ON "cover_changes"("user_id", "event", "event_key", "change");

-- AddForeignKey
ALTER TABLE "cover_changes" ADD CONSTRAINT "cover_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

