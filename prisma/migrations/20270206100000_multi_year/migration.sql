-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "retire_year" INTEGER,
ADD COLUMN     "multi_year_handled" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "tax_plan_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_plan_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_plan_events_user_id_idx" ON "tax_plan_events"("user_id");

-- AddForeignKey
ALTER TABLE "tax_plan_events" ADD CONSTRAINT "tax_plan_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
