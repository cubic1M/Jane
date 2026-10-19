-- CreateTable
CREATE TABLE "employer_benefits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "per_pay_cents" INTEGER NOT NULL,
    "pay_frequency" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'found',
    "source" TEXT NOT NULL,
    "policy_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employer_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employer_benefits_user_id_status_idx" ON "employer_benefits"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employer_benefits_user_id_employer_kind_label_key" ON "employer_benefits"("user_id", "employer", "kind", "label");

-- AddForeignKey
ALTER TABLE "employer_benefits" ADD CONSTRAINT "employer_benefits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

