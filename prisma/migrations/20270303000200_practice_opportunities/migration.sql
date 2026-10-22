-- CreateTable
CREATE TABLE "practice_opportunities" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "trade_ids" TEXT[],

    CONSTRAINT "practice_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_opportunities_user_id_scanned_at_idx" ON "practice_opportunities"("user_id", "scanned_at");

-- CreateIndex
CREATE UNIQUE INDEX "practice_opportunities_portfolio_id_key_key" ON "practice_opportunities"("portfolio_id", "key");

-- AddForeignKey
ALTER TABLE "practice_opportunities" ADD CONSTRAINT "practice_opportunities_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "practice_portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
