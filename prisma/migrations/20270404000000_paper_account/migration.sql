-- CreateTable
CREATE TABLE "paper_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "starting_cents" INTEGER NOT NULL,
    "cash_cents" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "strategy" TEXT NOT NULL,
    "price_source" TEXT NOT NULL,
    "hold" JSONB NOT NULL,
    "prices" JSONB NOT NULL DEFAULT '{}',
    "prices_date" DATE,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "last_run_at" TIMESTAMPTZ(3),

    CONSTRAINT "paper_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_positions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "cost_basis_cents" INTEGER NOT NULL,

    CONSTRAINT "paper_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_trades" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL,
    "ticker" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "signal_id" TEXT,
    "reverted_at" TIMESTAMPTZ(3),

    CONSTRAINT "paper_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_values" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "value_cents" INTEGER NOT NULL,
    "hold_cents" INTEGER NOT NULL,

    CONSTRAINT "paper_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_signals" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ(3),

    CONSTRAINT "paper_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "paper_accounts_user_id_key" ON "paper_accounts"("user_id");

-- CreateIndex
CREATE INDEX "paper_positions_user_id_idx" ON "paper_positions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_positions_account_id_ticker_key" ON "paper_positions"("account_id", "ticker");

-- CreateIndex
CREATE INDEX "paper_trades_account_id_placed_at_idx" ON "paper_trades"("account_id", "placed_at");

-- CreateIndex
CREATE INDEX "paper_trades_user_id_idx" ON "paper_trades"("user_id");

-- CreateIndex
CREATE INDEX "paper_values_user_id_idx" ON "paper_values"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_values_account_id_date_key" ON "paper_values"("account_id", "date");

-- CreateIndex
CREATE INDEX "paper_signals_user_id_status_idx" ON "paper_signals"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "paper_signals_account_id_key_key" ON "paper_signals"("account_id", "key");

-- AddForeignKey
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_values" ADD CONSTRAINT "paper_values_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_signals" ADD CONSTRAINT "paper_signals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

