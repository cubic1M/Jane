-- CreateTable
CREATE TABLE "problem_reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "problem_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "problem_reports_created_at_idx" ON "problem_reports"("created_at");

-- CreateIndex
CREATE INDEX "problem_reports_user_id_idx" ON "problem_reports"("user_id");

-- AddForeignKey
ALTER TABLE "problem_reports" ADD CONSTRAINT "problem_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

