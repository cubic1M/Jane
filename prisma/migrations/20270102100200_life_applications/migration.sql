-- CreateTable
CREATE TABLE "life_applications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sized',
    "amount_cents" INTEGER NOT NULL,
    "term_years" INTEGER NOT NULL,
    "method" JSONB NOT NULL,
    "term_why" TEXT NOT NULL,
    "quotes" JSONB NOT NULL DEFAULT '[]',
    "quote_id" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "decision" JSONB,
    "policy_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),

    CONSTRAINT "life_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "life_applications_user_id_status_idx" ON "life_applications"("user_id", "status");

-- AddForeignKey
ALTER TABLE "life_applications" ADD CONSTRAINT "life_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

