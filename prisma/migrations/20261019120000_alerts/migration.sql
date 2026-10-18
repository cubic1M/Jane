-- CreateEnum
CREATE TYPE "alert_type" AS ENUM ('new_subscription', 'price_increase', 'fee_charged', 'large_charge', 'duplicate_charge', 'low_balance');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "alert_prefs" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "alert_type" NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(3),
    "emailed_at" TIMESTAMPTZ(3),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_user_id_created_at_idx" ON "alerts"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_user_id_type_key_key" ON "alerts"("user_id", "type", "key");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

