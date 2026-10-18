-- AlterEnum
ALTER TYPE "decision_source" ADD VALUE 'text';

-- CreateTable
CREATE TABLE "text_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "phone_hmac" TEXT NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_version" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMPTZ(3),
    "code_tries" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "opted_out_at" TIMESTAMPTZ(3),
    "alerts" BOOLEAN NOT NULL DEFAULT true,
    "weekly_plan" BOOLEAN NOT NULL DEFAULT true,
    "needs_you" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "text_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "text_messages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_id" TEXT,
    "send_after" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "items" JSONB,
    "week_start" DATE,
    "expires_at" TIMESTAMPTZ(3),
    "used_at" TIMESTAMPTZ(3),
    "decision_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "text_settings_user_id_key" ON "text_settings"("user_id");

-- CreateIndex
CREATE INDEX "text_settings_phone_hmac_idx" ON "text_settings"("phone_hmac");

-- CreateIndex
CREATE UNIQUE INDEX "text_messages_provider_id_key" ON "text_messages"("provider_id");

-- CreateIndex
CREATE INDEX "text_messages_user_id_created_at_idx" ON "text_messages"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "text_messages_user_id_week_start_key" ON "text_messages"("user_id", "week_start");

-- AddForeignKey
ALTER TABLE "text_settings" ADD CONSTRAINT "text_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "text_messages" ADD CONSTRAINT "text_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

