-- CreateTable
CREATE TABLE "draft_returns" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "notes" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "findings" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "draft_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "draft_returns_document_id_key" ON "draft_returns"("document_id");

-- CreateIndex
CREATE INDEX "draft_returns_user_id_idx" ON "draft_returns"("user_id");

-- AddForeignKey
ALTER TABLE "draft_returns" ADD CONSTRAINT "draft_returns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_returns" ADD CONSTRAINT "draft_returns_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

