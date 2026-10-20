-- CreateTable
CREATE TABLE "retirement_incomes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ss_monthly_cents" INTEGER,
    "retire_age" INTEGER,
    "ss_start_age" INTEGER,
    "spend_monthly_cents" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retirement_incomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "retirement_incomes_user_id_key" ON "retirement_incomes"("user_id");

-- AddForeignKey
ALTER TABLE "retirement_incomes" ADD CONSTRAINT "retirement_incomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

