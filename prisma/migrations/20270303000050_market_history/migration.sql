-- CreateTable
CREATE TABLE "market_prices" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "close_cents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "market_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_history_loads" (
    "id" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "rows" INTEGER NOT NULL,
    "loaded_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "market_history_loads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_prices_ticker_date_idx" ON "market_prices"("ticker", "date");

-- CreateIndex
CREATE UNIQUE INDEX "market_prices_ticker_date_key" ON "market_prices"("ticker", "date");

-- CreateIndex
CREATE UNIQUE INDEX "market_history_loads_ticker_source_key" ON "market_history_loads"("ticker", "source");
