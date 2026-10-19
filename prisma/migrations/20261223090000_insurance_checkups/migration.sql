-- CreateTable
CREATE TABLE "insurance_checkups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "life_event_id" TEXT,
    "recommendations" JSONB NOT NULL DEFAULT '[]',
    "seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_checkups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_checkups_user_id_created_at_idx" ON "insurance_checkups"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "insurance_checkups" ADD CONSTRAINT "insurance_checkups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

