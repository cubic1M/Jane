-- CreateTable
CREATE TABLE "credit_disputes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "item_kind" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "amount_cents" INTEGER,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_on" DATE NOT NULL,
    "deadline_id" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "outcome" TEXT,

    CONSTRAINT "credit_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_disputes_user_id_key_key" ON "credit_disputes"("user_id", "key");

-- AddForeignKey
ALTER TABLE "credit_disputes" ADD CONSTRAINT "credit_disputes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

