-- The 24-hour trading agent: its settings and state on the paper account, fees on its trades,
-- and the intraday bar cache.
ALTER TABLE "paper_accounts" ADD COLUMN "agent_policy" TEXT,
ADD COLUMN "agent_param" DOUBLE PRECISION,
ADD COLUMN "agent_interval" TEXT,
ADD COLUMN "agent_market" TEXT,
ADD COLUMN "agent_state" JSONB,
ADD COLUMN "agent_started_at" TIMESTAMPTZ(3),
ADD COLUMN "agent_last_bar_at" TIMESTAMPTZ(3);

ALTER TABLE "paper_trades" ADD COLUMN "fee_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "spread_cents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "market_bars" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "t" TIMESTAMPTZ(3) NOT NULL,
    "o" INTEGER NOT NULL,
    "h" INTEGER NOT NULL,
    "l" INTEGER NOT NULL,
    "c" INTEGER NOT NULL,
    "v" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "market_bars_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "market_bar_ranges" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "from_at" TIMESTAMPTZ(3) NOT NULL,
    "to_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "market_bar_ranges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_bars_source_ticker_interval_t_key" ON "market_bars"("source", "ticker", "interval", "t");

CREATE UNIQUE INDEX "market_bar_ranges_source_ticker_interval_key" ON "market_bar_ranges"("source", "ticker", "interval");
