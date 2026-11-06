-- The connector action pipeline (src/lib/connectors/pipeline.ts, docs/connectors.md), off unless
-- CONNECTORS=1. Row-level security reaches it by user_id (docs/security/rls.md).
CREATE TABLE "connector_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_yes',
    "amount_cents" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "details" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "consent_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "approved_cents" INTEGER,
    "run_at" TIMESTAMPTZ(3),
    "external_ref" TEXT,
    "cancel_until" TIMESTAMPTZ(3),
    "reason" TEXT,
    "note" TEXT,
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connector_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connector_actions_user_id_idempotency_key_key" ON "connector_actions"("user_id", "idempotency_key");

CREATE UNIQUE INDEX "connector_actions_connector_id_external_ref_key" ON "connector_actions"("connector_id", "external_ref");

CREATE INDEX "connector_actions_user_id_created_at_idx" ON "connector_actions"("user_id", "created_at");

ALTER TABLE "connector_actions" ADD CONSTRAINT "connector_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
