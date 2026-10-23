-- CreateTable
CREATE TABLE "books_issues" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "account_id" TEXT,
    "item_id" TEXT,
    "detail" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fixed_at" TIMESTAMPTZ(3),

    CONSTRAINT "books_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "books_issues_user_id_status_idx" ON "books_issues"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "books_issues_user_id_key_key" ON "books_issues"("user_id", "key");

-- AddForeignKey
ALTER TABLE "books_issues" ADD CONSTRAINT "books_issues_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


