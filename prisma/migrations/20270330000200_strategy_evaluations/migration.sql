-- CreateTable
CREATE TABLE "strategy_evaluations" (
    "id" TEXT NOT NULL,
    "ran_at" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "chosen" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategy_evaluations_ran_at_idx" ON "strategy_evaluations"("ran_at");

