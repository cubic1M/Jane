-- CreateTable
CREATE TABLE "credit_goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target_score" INTEGER NOT NULL,
    "target_date" DATE NOT NULL,
    "done" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_on" DATE,

    CONSTRAINT "credit_goals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_goals_user_id_idx" ON "credit_goals"("user_id");

-- AddForeignKey
ALTER TABLE "credit_goals" ADD CONSTRAINT "credit_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

