-- CreateTable
CREATE TABLE "auto_invest_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "account_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_payday_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auto_invest_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_invest_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payday_on" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "safe_cents" INTEGER,
    "batch_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_invest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_invest_plans_user_id_key" ON "auto_invest_plans"("user_id");

-- CreateIndex
CREATE INDEX "auto_invest_runs_user_id_created_at_idx" ON "auto_invest_runs"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "auto_invest_runs_user_id_payday_on_key" ON "auto_invest_runs"("user_id", "payday_on");

-- AddForeignKey
ALTER TABLE "auto_invest_plans" ADD CONSTRAINT "auto_invest_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_invest_runs" ADD CONSTRAINT "auto_invest_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

