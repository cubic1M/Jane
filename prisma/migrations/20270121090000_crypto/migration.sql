-- CreateTable
CREATE TABLE "crypto_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "address" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "fees_cents" INTEGER NOT NULL DEFAULT 0,
    "traded_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crypto_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_holdings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "value_cents" INTEGER NOT NULL,
    "cost_basis_cents" INTEGER,
    "as_of" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "crypto_holdings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crypto_connections_user_id_idx" ON "crypto_connections"("user_id");

-- CreateIndex
CREATE INDEX "crypto_holdings_user_id_idx" ON "crypto_holdings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_holdings_connection_id_asset_key" ON "crypto_holdings"("connection_id", "asset");

-- AddForeignKey
ALTER TABLE "crypto_connections" ADD CONSTRAINT "crypto_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_holdings" ADD CONSTRAINT "crypto_holdings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_holdings" ADD CONSTRAINT "crypto_holdings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "crypto_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

