-- CreateTable
CREATE TABLE "card_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "card_name" TEXT NOT NULL,
    "annual_fee_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "partner_application_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_applications_user_id_idx" ON "card_applications"("user_id");

-- AddForeignKey
ALTER TABLE "card_applications" ADD CONSTRAINT "card_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

