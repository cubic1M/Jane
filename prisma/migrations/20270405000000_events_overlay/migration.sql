-- CreateTable
CREATE TABLE "market_events" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "known_at" TIMESTAMPTZ(3) NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "strength" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_event_overlays" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "on" BOOLEAN NOT NULL DEFAULT false,
    "switched_at" TIMESTAMPTZ(3) NOT NULL,
    "last_date" DATE,
    "state" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "paper_event_overlays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paper_event_logs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_title" TEXT NOT NULL,
    "ticker" TEXT,
    "side" TEXT,
    "tilt" DOUBLE PRECISION,
    "amount_cents" INTEGER,
    "confidence" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "trade_ids" TEXT[],
    "seen_at" TIMESTAMPTZ(3),

    CONSTRAINT "paper_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_events_key_key" ON "market_events"("key");

-- CreateIndex
CREATE INDEX "market_events_known_at_idx" ON "market_events"("known_at");

-- CreateIndex
CREATE UNIQUE INDEX "paper_event_overlays_account_id_key" ON "paper_event_overlays"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "paper_event_overlays_user_id_key" ON "paper_event_overlays"("user_id");

-- CreateIndex
CREATE INDEX "paper_event_logs_user_id_at_idx" ON "paper_event_logs"("user_id", "at");

-- CreateIndex
CREATE UNIQUE INDEX "paper_event_logs_account_id_event_key_kind_ticker_key" ON "paper_event_logs"("account_id", "event_key", "kind", "ticker");

-- AddForeignKey
ALTER TABLE "paper_event_overlays" ADD CONSTRAINT "paper_event_overlays_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paper_event_logs" ADD CONSTRAINT "paper_event_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "paper_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

