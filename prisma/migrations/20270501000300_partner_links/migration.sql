-- Stage 3: a partner's own id for something of the person's (a payer, a card to pay). Empty until a
-- real partner is connected.
CREATE TABLE "partner_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_links_user_id_partner_kind_ref_key" ON "partner_links"("user_id", "partner", "kind", "ref");

ALTER TABLE "partner_links" ADD CONSTRAINT "partner_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
