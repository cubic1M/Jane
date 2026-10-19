-- CreateTable
CREATE TABLE "answer_check_runs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "score" INTEGER,
    "graded" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "stopped_at_cap" BOOLEAN NOT NULL,
    "first_words_ms" INTEGER,
    "results" JSONB NOT NULL,

    CONSTRAINT "answer_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "answer_check_runs_created_at_idx" ON "answer_check_runs"("created_at");

