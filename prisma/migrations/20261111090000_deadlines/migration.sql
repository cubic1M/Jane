-- CreateEnum
CREATE TYPE "deadline_kind" AS ENUM ('fsa', 'card_benefit', 'warranty', 'other');

-- AlterEnum
ALTER TYPE "alert_type" ADD VALUE 'deadline_soon';

-- CreateTable
CREATE TABLE "deadlines" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "kind" "deadline_kind" NOT NULL DEFAULT 'other',
    "note" TEXT,
    "done_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deadlines_user_id_due_on_idx" ON "deadlines"("user_id", "due_on");

-- AddForeignKey
ALTER TABLE "deadlines" ADD CONSTRAINT "deadlines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

