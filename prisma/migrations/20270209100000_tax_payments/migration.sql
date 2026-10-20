-- CreateTable
CREATE TABLE "tax_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "due_on" DATE NOT NULL,
    "cents" INTEGER NOT NULL,
    "partner" TEXT NOT NULL,
    "confirmation" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_payments_user_id_due_on_key" ON "tax_payments"("user_id", "due_on");

-- AddForeignKey
ALTER TABLE "tax_payments" ADD CONSTRAINT "tax_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
