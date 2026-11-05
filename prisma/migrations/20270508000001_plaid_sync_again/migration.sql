-- A webhook came while a sync ran: it reads again when it's done.
ALTER TABLE "plaid_items" ADD COLUMN "sync_again" BOOLEAN NOT NULL DEFAULT false;
