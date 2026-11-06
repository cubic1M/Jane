-- Connectors (docs/connectors.md), off unless CONNECTORS=1: a person's consent to each connector, and
-- the vault of their encrypted credentials. Row-level security reaches both by user_id
-- (docs/security/rls.md).
CREATE TABLE "connector_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "scopes" TEXT[],
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "connector_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "connector_consents_user_id_connector_id_idx" ON "connector_consents"("user_id", "connector_id");

ALTER TABLE "connector_consents" ADD CONSTRAINT "connector_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "connector_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connector_id" TEXT NOT NULL,
    "secret_encrypted" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "connector_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "connector_credentials_user_id_connector_id_key" ON "connector_credentials"("user_id", "connector_id");

ALTER TABLE "connector_credentials" ADD CONSTRAINT "connector_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
