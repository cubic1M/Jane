-- CreateTable
CREATE TABLE "merchant_outcomes" (
    "id" TEXT NOT NULL,
    "merchant_key" TEXT NOT NULL,
    "action_type" "action_type" NOT NULL,
    "cases" INTEGER NOT NULL,
    "succeeded" INTEGER NOT NULL,
    "median_minutes" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merchant_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_outcomes_merchant_key_action_type_key" ON "merchant_outcomes"("merchant_key", "action_type");

