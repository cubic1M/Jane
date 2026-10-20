-- CreateTable
CREATE TABLE "year_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "start_month" TEXT NOT NULL,
    "months" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "year_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "year_plans_user_id_start_month_key" ON "year_plans"("user_id", "start_month");

-- AddForeignKey
ALTER TABLE "year_plans" ADD CONSTRAINT "year_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

