-- AlterTable
ALTER TABLE "import_runs" ADD COLUMN     "account_id" TEXT,
ADD COLUMN     "file_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "from_date" DATE,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'upload',
ADD COLUMN     "to_date" DATE;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "import_run_id" TEXT;

-- CreateIndex
CREATE INDEX "import_runs_account_id_idx" ON "import_runs"("account_id");

-- CreateIndex
CREATE INDEX "transactions_import_run_id_idx" ON "transactions"("import_run_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
