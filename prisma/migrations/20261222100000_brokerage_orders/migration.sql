-- CreateTable
CREATE TABLE "brokerage_orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "security_name" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "confirmation" TEXT,
    "placed_at" TIMESTAMPTZ(3) NOT NULL,
    "filled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brokerage_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brokerage_orders_user_id_placed_at_idx" ON "brokerage_orders"("user_id", "placed_at");

-- CreateIndex
CREATE INDEX "brokerage_orders_account_id_idx" ON "brokerage_orders"("account_id");

-- AddForeignKey
ALTER TABLE "brokerage_orders" ADD CONSTRAINT "brokerage_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brokerage_orders" ADD CONSTRAINT "brokerage_orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

