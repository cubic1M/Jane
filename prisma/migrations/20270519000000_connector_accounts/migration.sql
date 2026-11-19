-- Accounts read through a connector (read connectors, batch 2): Method's loans and cards, SnapTrade's
-- brokerage accounts. Each carries its source, the person's connection (connector_credentials) and the
-- partner's own id for it, so revoking that connection takes its accounts with it, as a Robinhood
-- disconnect does. Off for real people (src/config/connectors.ts). Row-level security already reaches
-- accounts by user_id (docs/security/rls.md).
ALTER TYPE "data_source" ADD VALUE IF NOT EXISTS 'method';
ALTER TYPE "data_source" ADD VALUE IF NOT EXISTS 'snaptrade';

ALTER TABLE "accounts" ADD COLUMN "connector_credential_id" TEXT,
ADD COLUMN "external_account_id" TEXT;

CREATE UNIQUE INDEX "accounts_connector_credential_id_external_account_id_key" ON "accounts"("connector_credential_id", "external_account_id");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_connector_credential_id_fkey" FOREIGN KEY ("connector_credential_id") REFERENCES "connector_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
