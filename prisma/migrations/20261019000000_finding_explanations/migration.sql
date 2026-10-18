-- CreateEnum
CREATE TYPE "explanation_source" AS ENUM ('llm', 'template');

-- AlterTable: explanation becomes the card text as JSON. Nothing wrote the old text column,
-- but any value there is kept as the explanation field.
ALTER TABLE "findings" ALTER COLUMN "explanation" TYPE JSONB
  USING CASE WHEN "explanation" IS NULL THEN NULL ELSE jsonb_build_object('explanation', "explanation") END;
ALTER TABLE "findings" ADD COLUMN     "explanation_input_hash" TEXT,
ADD COLUMN     "explanation_model" TEXT,
ADD COLUMN     "explanation_prompt_version" TEXT,
ADD COLUMN     "explanation_source" "explanation_source";

-- CreateTable
CREATE TABLE "subscription_checks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant_key" TEXT NOT NULL,
    "is_subscription" BOOLEAN NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_checks_user_id_merchant_key_key" ON "subscription_checks"("user_id", "merchant_key");

-- AddForeignKey
ALTER TABLE "subscription_checks" ADD CONSTRAINT "subscription_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
