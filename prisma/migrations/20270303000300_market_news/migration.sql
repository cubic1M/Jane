-- CreateTable
CREATE TABLE "market_news" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "feed" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ticker" TEXT,
    "date" DATE NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "form" TEXT,
    "summary" TEXT,
    "summary_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_news_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_summary_calls" (
    "id" TEXT NOT NULL,
    "called_at" TIMESTAMPTZ(3) NOT NULL,
    "model" TEXT NOT NULL,
    "headlines" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_hundredths" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "news_summary_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_news_key_key" ON "market_news"("key");

-- CreateIndex
CREATE INDEX "market_news_feed_kind_date_idx" ON "market_news"("feed", "kind", "date");

-- CreateIndex
CREATE INDEX "news_summary_calls_called_at_idx" ON "news_summary_calls"("called_at");

