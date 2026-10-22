-- CreateTable
CREATE TABLE "sudden_moneys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "deposited_on" DATE NOT NULL,
    "kind" TEXT,
    "basis_cents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'asked',
    "done" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sudden_moneys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sudden_moneys_transaction_id_key" ON "sudden_moneys"("transaction_id");

-- CreateIndex
CREATE INDEX "sudden_moneys_user_id_idx" ON "sudden_moneys"("user_id");

-- AddForeignKey
ALTER TABLE "sudden_moneys" ADD CONSTRAINT "sudden_moneys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sudden_moneys" ADD CONSTRAINT "sudden_moneys_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

