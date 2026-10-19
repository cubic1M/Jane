-- CreateTable
CREATE TABLE "budget_tune_ups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_tune_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_transfers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "goal_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_tune_ups_user_id_month_key" ON "budget_tune_ups"("user_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "goal_transfers_user_id_transaction_id_key" ON "goal_transfers"("user_id", "transaction_id");

-- AddForeignKey
ALTER TABLE "budget_tune_ups" ADD CONSTRAINT "budget_tune_ups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_transfers" ADD CONSTRAINT "goal_transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

