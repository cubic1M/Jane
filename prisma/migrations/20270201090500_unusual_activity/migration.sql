-- AlterEnum
ALTER TYPE "alert_type" ADD VALUE 'unusual_activity';

-- CreateTable
CREATE TABLE "unusual_answers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "merchant_key" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "finding_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unusual_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unusual_answers_user_id_merchant_key_idx" ON "unusual_answers"("user_id", "merchant_key");

-- CreateIndex
CREATE UNIQUE INDEX "unusual_answers_user_id_alert_id_key" ON "unusual_answers"("user_id", "alert_id");

-- AddForeignKey
ALTER TABLE "unusual_answers" ADD CONSTRAINT "unusual_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

