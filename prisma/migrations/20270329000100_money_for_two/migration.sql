-- AlterTable
ALTER TABLE "households" ADD COLUMN     "big_move_cents" INTEGER,
ADD COLUMN     "split_rule" TEXT NOT NULL DEFAULT 'even',
ADD COLUMN     "split_set_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "money_transfers" ADD COLUMN     "approved_by_id" TEXT;

-- AlterTable
ALTER TABLE "savings_goals" ADD COLUMN     "shared_with_household" BOOLEAN NOT NULL DEFAULT false;

