-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "rule_key" TEXT;

-- CreateTable
CREATE TABLE "standing_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "monthly_limit" INTEGER NOT NULL,
    "max_annual_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "standing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "standing_rules_user_id_key_key" ON "standing_rules"("user_id", "key");

-- AddForeignKey
ALTER TABLE "standing_rules" ADD CONSTRAINT "standing_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

