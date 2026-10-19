-- CreateTable
CREATE TABLE "credit_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "range_low" INTEGER NOT NULL,
    "range_high" INTEGER NOT NULL,
    "card_limit_cents" INTEGER NOT NULL,
    "average_age_months" INTEGER NOT NULL,
    "hard_inquiries" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "pulled_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_reports_user_id_pulled_on_idx" ON "credit_reports"("user_id", "pulled_on");

-- AddForeignKey
ALTER TABLE "credit_reports" ADD CONSTRAINT "credit_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

