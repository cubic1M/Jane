-- AlterTable
ALTER TABLE "users" ADD COLUMN     "state" TEXT;

-- CreateTable
CREATE TABLE "referral_partners" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "action_type" "action_type" NOT NULL,
    "disclosure" TEXT NOT NULL,
    "referral_url" TEXT NOT NULL,
    "allowed_states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT false,
    "revenue_per_conversion_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "referral_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_conversions" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_partners_key_key" ON "referral_partners"("key");

-- CreateIndex
CREATE INDEX "referral_conversions_partner_id_created_at_idx" ON "referral_conversions"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "referral_conversions_user_id_idx" ON "referral_conversions"("user_id");

-- AddForeignKey
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "referral_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_conversions" ADD CONSTRAINT "referral_conversions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

