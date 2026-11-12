-- Jane's offers catalog (src/lib/offers/, src/config/offers.ts): market options and figures with their
-- source, check time and expiry. Shared reference data with no user_id, so only the system's door
-- reaches it (docs/security/rls.md).
CREATE TABLE "market_offers" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value_bps" INTEGER,
    "value_cents" INTEGER,
    "minimum_balance_cents" INTEGER NOT NULL DEFAULT 0,
    "merchant_key" TEXT,
    "source_url" TEXT NOT NULL,
    "sign_up_url" TEXT,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'live',
    "extracted_by" TEXT NOT NULL,
    "fingerprint" TEXT,
    "changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "market_offers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_offers_key_key" ON "market_offers"("key");

CREATE INDEX "market_offers_kind_status_expires_at_idx" ON "market_offers"("kind", "status", "expires_at");

CREATE INDEX "market_offers_source_idx" ON "market_offers"("source");

CREATE TABLE "market_offer_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "offer_key" TEXT,
    "kind" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_offer_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "market_offer_events_kind_created_at_idx" ON "market_offer_events"("kind", "created_at");

CREATE INDEX "market_offer_events_source_created_at_idx" ON "market_offer_events"("source", "created_at");
