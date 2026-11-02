-- How many Plaid Production Items were ever created (src/lib/plaid/item-slots.ts): one row with a
-- number and no personal data, never lowered by removing an Item or deleting an account.
CREATE TABLE "plaid_item_counter" (
    "id" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "plaid_item_counter_pkey" PRIMARY KEY ("id")
);

-- Which of a person's allowed Production Items they have used. Goes with the person's account.
CREATE TABLE "plaid_item_claims" (
    "user_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plaid_item_claims_pkey" PRIMARY KEY ("user_id","ordinal")
);

ALTER TABLE "plaid_item_claims" ADD CONSTRAINT "plaid_item_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
