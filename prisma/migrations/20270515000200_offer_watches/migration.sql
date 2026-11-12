-- Reverse matching's index (src/lib/live/watches.ts): what a market change could help each person
-- with. Row-level security reaches it by user_id (docs/security/rls.md).
CREATE TABLE "offer_watches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "idle_cents" INTEGER,
    "rate_bps" INTEGER,
    "monthly_cents" INTEGER,
    "last_match" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "offer_watches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offer_watches_user_id_target_key" ON "offer_watches"("user_id", "target");

CREATE INDEX "offer_watches_target_idx" ON "offer_watches"("target");

ALTER TABLE "offer_watches" ADD CONSTRAINT "offer_watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
