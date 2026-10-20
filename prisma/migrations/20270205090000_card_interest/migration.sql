-- CreateTable
CREATE TABLE "card_promos" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "card_name" TEXT NOT NULL,
    "balance_cents" INTEGER NOT NULL,
    "started_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "go_to_apr_bps" INTEGER NOT NULL,
    "deferred" BOOLEAN NOT NULL DEFAULT false,
    "deadline_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_rate_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "debt_key" TEXT NOT NULL,
    "card_name" TEXT NOT NULL,
    "old_apr_bps" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "new_apr_bps" INTEGER,
    "saving_yearly_cents" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT,

    CONSTRAINT "card_rate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_promos_user_id_idx" ON "card_promos"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_rate_requests_user_id_key_key" ON "card_rate_requests"("user_id", "key");

-- AddForeignKey
ALTER TABLE "card_promos" ADD CONSTRAINT "card_promos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_rate_requests" ADD CONSTRAINT "card_rate_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

