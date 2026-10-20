-- CreateTable
CREATE TABLE "costly_products" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "value_cents" INTEGER NOT NULL DEFAULT 0,
    "fee_bps" INTEGER NOT NULL DEFAULT 0,
    "premium_yearly_cents" INTEGER NOT NULL DEFAULT 0,
    "purchased_on" DATE NOT NULL,
    "surrender_schedule" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "costly_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "costly_products_user_id_idx" ON "costly_products"("user_id");

-- AddForeignKey
ALTER TABLE "costly_products" ADD CONSTRAINT "costly_products_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

