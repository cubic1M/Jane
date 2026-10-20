-- CreateTable
CREATE TABLE "insurance_risks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'asked',
    "merchant" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "seen_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(3),

    CONSTRAINT "insurance_risks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_risks_user_id_status_idx" ON "insurance_risks"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_risks_user_id_kind_key" ON "insurance_risks"("user_id", "kind");

-- AddForeignKey
ALTER TABLE "insurance_risks" ADD CONSTRAINT "insurance_risks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
