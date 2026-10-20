-- AlterTable
ALTER TABLE "tax_profiles" ADD COLUMN     "ip_pin_have_year" INTEGER,
ADD COLUMN     "ip_pin_reminded_year" INTEGER;

-- CreateTable
CREATE TABLE "tax_identity_cases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sign" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "opened_on" DATE NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '{}',
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_identity_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_identity_cases_user_id_idx" ON "tax_identity_cases"("user_id");

-- AddForeignKey
ALTER TABLE "tax_identity_cases" ADD CONSTRAINT "tax_identity_cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

