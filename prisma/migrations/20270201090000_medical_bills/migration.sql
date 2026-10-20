-- CreateTable
CREATE TABLE "medical_bills" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "billed_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bill_key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "outcome" TEXT,
    "saved_cents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "medical_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medical_bills_user_id_idx" ON "medical_bills"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "medical_requests_user_id_key_key" ON "medical_requests"("user_id", "key");

-- AddForeignKey
ALTER TABLE "medical_bills" ADD CONSTRAINT "medical_bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_requests" ADD CONSTRAINT "medical_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

