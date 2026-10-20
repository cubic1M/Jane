-- CreateTable
CREATE TABLE "equity_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "occurred_on" DATE NOT NULL,
    "granted_on" DATE,
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "fmv_cents" INTEGER NOT NULL,
    "withheld_cents" INTEGER,
    "sold_on" DATE,
    "sold_price_cents" INTEGER,
    "grant_discount_cents" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equity_events_user_id_idx" ON "equity_events"("user_id");

-- AddForeignKey
ALTER TABLE "equity_events" ADD CONSTRAINT "equity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

