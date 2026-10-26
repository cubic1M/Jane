-- Plaid hardening: new accounts waiting to be shared, the last non-sign-in failure, a lock
-- for webhook syncs, and the webhooks already handled.
ALTER TABLE "plaid_items" ADD COLUMN "new_accounts_available" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "plaid_items" ADD COLUMN "last_error_code" TEXT;
ALTER TABLE "plaid_items" ADD COLUMN "last_error_at" TIMESTAMPTZ(3);
ALTER TABLE "plaid_items" ADD COLUMN "syncing_since" TIMESTAMPTZ(3);

CREATE TABLE "plaid_webhook_events" (
    "id" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "plaid_item_id" TEXT,
    "webhook_type" TEXT NOT NULL,
    "webhook_code" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plaid_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plaid_webhook_events_body_hash_key" ON "plaid_webhook_events"("body_hash");
CREATE INDEX "plaid_webhook_events_received_at_idx" ON "plaid_webhook_events"("received_at");
