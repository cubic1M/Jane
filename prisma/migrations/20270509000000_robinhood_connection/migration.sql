-- A person's read-only Robinhood connection (docs/setup/robinhood.md), off unless ROBINHOOD_LINK=1.
-- Row-level security reaches robinhood_connections by its user_id (docs/security/rls.md);
-- robinhood_oauth_clients has no owner, so only the system's door reaches it.
ALTER TYPE "data_source" ADD VALUE IF NOT EXISTS 'robinhood';

CREATE TABLE "robinhood_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "secrets_encrypted" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "access_expires_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_synced_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "last_error_at" TIMESTAMPTZ(3),
    "failures" INTEGER NOT NULL DEFAULT 0,
    "next_try_at" TIMESTAMPTZ(3),
    "syncing_since" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "robinhood_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "robinhood_connections_user_id_key" ON "robinhood_connections"("user_id");

ALTER TABLE "robinhood_connections" ADD CONSTRAINT "robinhood_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "robinhood_oauth_clients" (
    "id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "robinhood_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "robinhood_oauth_clients_issuer_redirect_uri_key" ON "robinhood_oauth_clients"("issuer", "redirect_uri");

ALTER TABLE "accounts" ADD COLUMN "robinhood_connection_id" TEXT;

CREATE INDEX "accounts_robinhood_connection_id_idx" ON "accounts"("robinhood_connection_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_robinhood_connection_id_fkey" FOREIGN KEY ("robinhood_connection_id") REFERENCES "robinhood_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
