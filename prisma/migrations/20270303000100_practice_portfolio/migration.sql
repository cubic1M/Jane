-- CreateTable
CREATE TABLE "practice_portfolios" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "starting_cents" INTEGER NOT NULL,
    "cash_cents" INTEGER NOT NULL,
    "monthly_add_cents" INTEGER NOT NULL DEFAULT 0,
    "add_day" INTEGER NOT NULL DEFAULT 1,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "opportunities_paused" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "practice_portfolios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_positions" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "cost_basis_cents" INTEGER NOT NULL,

    CONSTRAINT "practice_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_trades" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL,
    "side" TEXT NOT NULL,
    "ticker" TEXT,
    "quantity" DOUBLE PRECISION,
    "price_cents" INTEGER,
    "amount_cents" INTEGER NOT NULL,
    "gain_cents" INTEGER,
    "reason" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "undone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "practice_trades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "practice_portfolios_user_id_key" ON "practice_portfolios"("user_id");

-- CreateIndex
CREATE INDEX "practice_positions_user_id_idx" ON "practice_positions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "practice_positions_portfolio_id_ticker_key" ON "practice_positions"("portfolio_id", "ticker");

-- CreateIndex
CREATE INDEX "practice_trades_portfolio_id_placed_at_idx" ON "practice_trades"("portfolio_id", "placed_at");

-- CreateIndex
CREATE INDEX "practice_trades_user_id_idx" ON "practice_trades"("user_id");

-- AddForeignKey
ALTER TABLE "practice_portfolios" ADD CONSTRAINT "practice_portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_positions" ADD CONSTRAINT "practice_positions_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "practice_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_trades" ADD CONSTRAINT "practice_trades_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "practice_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
