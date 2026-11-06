-- What a person was shown and agreed to when they allowed a connector, its version, and where they
-- agreed from (src/lib/connectors/consent.ts). Nullable: rows from before stay as they were.
ALTER TABLE "connector_consents" ADD COLUMN "shown_text" TEXT;
ALTER TABLE "connector_consents" ADD COLUMN "text_version" TEXT;
ALTER TABLE "connector_consents" ADD COLUMN "ip" TEXT;
ALTER TABLE "connector_consents" ADD COLUMN "user_agent" TEXT;
