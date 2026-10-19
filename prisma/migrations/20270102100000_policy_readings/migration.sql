-- CreateTable
CREATE TABLE "policy_readings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "fields" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '{}',
    "notes" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(3),

    CONSTRAINT "policy_readings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policy_readings_document_id_key" ON "policy_readings"("document_id");

-- CreateIndex
CREATE INDEX "policy_readings_user_id_status_idx" ON "policy_readings"("user_id", "status");

-- AddForeignKey
ALTER TABLE "policy_readings" ADD CONSTRAINT "policy_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_readings" ADD CONSTRAINT "policy_readings_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

