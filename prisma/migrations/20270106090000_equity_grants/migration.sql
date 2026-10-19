-- CreateTable
CREATE TABLE "equity_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "ticker" TEXT,
    "kind" TEXT NOT NULL,
    "unvested_shares" DOUBLE PRECISION NOT NULL,
    "shares_per_vest" DOUBLE PRECISION,
    "every_months" INTEGER,
    "next_vest_on" DATE,
    "strike_cents" INTEGER,
    "espp_discount" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'you',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "equity_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equity_grants_user_id_idx" ON "equity_grants"("user_id");

-- AddForeignKey
ALTER TABLE "equity_grants" ADD CONSTRAINT "equity_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

