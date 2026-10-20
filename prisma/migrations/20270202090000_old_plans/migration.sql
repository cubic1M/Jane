-- CreateTable
CREATE TABLE "old_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'asked',
    "plan_name" TEXT,
    "balance_cents" INTEGER,
    "expense_ratio_bps" INTEGER,
    "locator" TEXT,
    "destination_id" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "rolling_since" TIMESTAMPTZ(3),
    "rolled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "old_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "old_plans_user_id_employer_key" ON "old_plans"("user_id", "employer");

-- AddForeignKey
ALTER TABLE "old_plans" ADD CONSTRAINT "old_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

