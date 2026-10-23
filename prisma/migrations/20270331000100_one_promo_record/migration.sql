-- One record of a 0% promotion (docs/feature-audit.md, cluster 14): a balance transfer Jane
-- arranged is also its card promotion, linked here, so its pace is tracked once.

-- AlterTable
ALTER TABLE "card_promos" ADD COLUMN     "balance_transfer_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "card_promos_balance_transfer_id_key" ON "card_promos"("balance_transfer_id");

-- Every running transfer gets its promotion record, sharing the transfer's deadline.
INSERT INTO "card_promos" ("id", "user_id", "card_name", "balance_cents", "started_on", "ends_on", "go_to_apr_bps", "deferred", "deadline_id", "balance_transfer_id", "created_at")
SELECT 'promo_' || "id", "user_id", "card_name", "amount_cents" + "fee_cents", "started_on", "promo_ends_on", "go_to_apr_bps", false, "deadline_id", "id", "created_at"
FROM "balance_transfers"
WHERE "status" = 'active';
