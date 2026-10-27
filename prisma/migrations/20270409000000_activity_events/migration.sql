-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "visit_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "role" TEXT,
    "label" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_events_user_id_created_at_idx" ON "activity_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_created_at_idx" ON "activity_events"("created_at");

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
