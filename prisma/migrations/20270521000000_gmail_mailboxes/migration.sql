-- A person's Gmail mailboxes, connected read-only, and the money emails Jane read in them: what each
-- said, never its text (src/lib/gmail/, docs/setup/gmail.md), off unless GMAIL_LINK=1. Row-level
-- security reaches both tables by user_id (docs/security/rls.md).
CREATE TABLE "gmail_mailboxes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "secrets_encrypted" TEXT NOT NULL,
    "access_expires_at" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "disclosure_version" TEXT NOT NULL,
    "agreed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "history_cursor" TEXT NOT NULL,
    "watch_expires_at" TIMESTAMPTZ(3),
    "last_checked_at" TIMESTAMPTZ(3),
    "missed_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "next_try_at" TIMESTAMPTZ(3),
    "syncing_since" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gmail_mailboxes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gmail_readings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "message_ref" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "sender_domain" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "occurs_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gmail_readings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gmail_mailboxes_address_idx" ON "gmail_mailboxes"("address");

CREATE UNIQUE INDEX "gmail_mailboxes_user_id_address_key" ON "gmail_mailboxes"("user_id", "address");

CREATE INDEX "gmail_readings_user_id_received_at_idx" ON "gmail_readings"("user_id", "received_at");

CREATE UNIQUE INDEX "gmail_readings_mailbox_id_message_ref_key" ON "gmail_readings"("mailbox_id", "message_ref");

ALTER TABLE "gmail_mailboxes" ADD CONSTRAINT "gmail_mailboxes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gmail_readings" ADD CONSTRAINT "gmail_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gmail_readings" ADD CONSTRAINT "gmail_readings_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "gmail_mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
