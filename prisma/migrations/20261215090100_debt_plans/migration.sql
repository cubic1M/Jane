-- CreateTable
CREATE TABLE "debt_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "extra_cents" INTEGER NOT NULL,
    "started_on" DATE NOT NULL,
    "checked_on" DATE NOT NULL,
    "expected" JSONB NOT NULL DEFAULT '[]',
    "debt_free_month" TEXT,
    "previous_debt_free_month" TEXT,
    "status" TEXT,
    "expected_cents" INTEGER,
    "actual_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "debt_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "debt_plans_user_id_key" ON "debt_plans"("user_id");

-- AddForeignKey
ALTER TABLE "debt_plans" ADD CONSTRAINT "debt_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

