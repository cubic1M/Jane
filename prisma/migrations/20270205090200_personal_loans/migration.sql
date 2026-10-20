-- CreateTable
CREATE TABLE "personal_loans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "principal_cents" INTEGER NOT NULL,
    "opened_on" DATE NOT NULL,
    "source_key" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "settled_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_loans_user_id_idx" ON "personal_loans"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "personal_loans_user_id_source_key_key" ON "personal_loans"("user_id", "source_key");

-- AddForeignKey
ALTER TABLE "personal_loans" ADD CONSTRAINT "personal_loans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

