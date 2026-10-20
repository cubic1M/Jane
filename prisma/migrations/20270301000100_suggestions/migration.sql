-- CreateTable
CREATE TABLE "suggestions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "worth_cents" INTEGER NOT NULL,
    "worth_kind" TEXT NOT NULL,
    "confidence_percent" INTEGER NOT NULL,
    "confidence_reason" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "action_label" TEXT NOT NULL,
    "action_href" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "selected_on" DATE,
    "answered_at" TIMESTAMPTZ(3),
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestions_user_id_status_idx" ON "suggestions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "suggestions_user_id_key_key" ON "suggestions"("user_id", "key");

-- AddForeignKey
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
