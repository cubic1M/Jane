-- AlterTable
ALTER TABLE "balance_snapshots" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "import_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "found_cents" INTEGER,
    "seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_user_id_created_at_idx" ON "import_runs"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
