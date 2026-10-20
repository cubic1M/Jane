-- CreateTable
CREATE TABLE "accountant_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accountant_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accountant_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "question_key" TEXT,
    "question_text" TEXT,
    "from_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accountant_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accountant_links_token_hash_key" ON "accountant_links"("token_hash");

-- CreateIndex
CREATE INDEX "accountant_links_user_id_idx" ON "accountant_links"("user_id");

-- CreateIndex
CREATE INDEX "accountant_notes_user_id_idx" ON "accountant_notes"("user_id");

-- CreateIndex
CREATE INDEX "accountant_notes_link_id_idx" ON "accountant_notes"("link_id");

-- AddForeignKey
ALTER TABLE "accountant_links" ADD CONSTRAINT "accountant_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountant_notes" ADD CONSTRAINT "accountant_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accountant_notes" ADD CONSTRAINT "accountant_notes_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "accountant_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
