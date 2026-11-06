-- Connector webhook intake (src/lib/connectors/webhooks.ts), off unless CONNECTORS=1: each delivery's
-- event id, to refuse a replay. No user_id, so only the system's door reaches it (docs/security/rls.md).
CREATE TABLE "connector_webhook_events" (
    "id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connector_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connector_webhook_events_connector_id_event_id_key" ON "connector_webhook_events"("connector_id", "event_id");

CREATE INDEX "connector_webhook_events_received_at_idx" ON "connector_webhook_events"("received_at");
