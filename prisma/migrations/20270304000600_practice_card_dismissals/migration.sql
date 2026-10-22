-- AlterTable
ALTER TABLE "practice_opportunities" ADD COLUMN     "dismissed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "practice_trades" ADD COLUMN     "dismissed_at" TIMESTAMPTZ(3);
