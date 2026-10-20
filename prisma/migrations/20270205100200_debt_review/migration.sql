-- AlterTable
ALTER TABLE "debt_watches" ADD COLUMN     "review_keys" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "review_on" DATE,
ADD COLUMN     "review_pay_cents" INTEGER,
ADD COLUMN     "review_reason" TEXT;

