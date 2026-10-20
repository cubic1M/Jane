-- CreateTable
CREATE TABLE "tight_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target_key" TEXT NOT NULL,
    "target_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "shortfall_on" DATE NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "outcome" TEXT,

    CONSTRAINT "tight_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tight_requests_user_id_key_key" ON "tight_requests"("user_id", "key");

-- AddForeignKey
ALTER TABLE "tight_requests" ADD CONSTRAINT "tight_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

