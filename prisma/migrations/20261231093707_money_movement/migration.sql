-- CreateTable
CREATE TABLE "money_transfers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT,
    "to_name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "goal_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "run_on" DATE NOT NULL,
    "partner" TEXT NOT NULL,
    "partner_ref" TEXT,
    "by" TEXT NOT NULL,
    "plan_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "money_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paycheck_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "paycheck_cents" INTEGER NOT NULL,
    "paid_on" DATE NOT NULL,
    "moves" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paycheck_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "money_transfers_user_id_status_idx" ON "money_transfers"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "paycheck_plans_user_id_key_key" ON "paycheck_plans"("user_id", "key");

-- AddForeignKey
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paycheck_plans" ADD CONSTRAINT "paycheck_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

