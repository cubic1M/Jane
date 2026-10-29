-- CreateTable
CREATE TABLE "user_facts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "label" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "confidence" INTEGER NOT NULL,
    "evidence_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen" TIMESTAMPTZ(3) NOT NULL,
    "last_confirmed" TIMESTAMPTZ(3) NOT NULL,
    "superseded_by" TEXT,

    CONSTRAINT "user_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_facts_user_id_key_idx" ON "user_facts"("user_id", "key");

-- CreateIndex
CREATE INDEX "user_facts_superseded_by_idx" ON "user_facts"("superseded_by");

-- AddForeignKey
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_facts" ADD CONSTRAINT "user_facts_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "user_facts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

