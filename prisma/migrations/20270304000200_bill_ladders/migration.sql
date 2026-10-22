-- CreateTable
CREATE TABLE "bill_ladders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "goal_id" TEXT,
    "name" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "start_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "rungs" JSONB NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_ladders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_ladders_user_id_idx" ON "bill_ladders"("user_id");

-- AddForeignKey
ALTER TABLE "bill_ladders" ADD CONSTRAINT "bill_ladders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

