-- AlterEnum
ALTER TYPE "alert_type" ADD VALUE 'estimated_tax';

-- CreateTable
CREATE TABLE "life_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "started_on" DATE NOT NULL,
    "checked_items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "life_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "life_events_user_id_idx" ON "life_events"("user_id");

-- AddForeignKey
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

