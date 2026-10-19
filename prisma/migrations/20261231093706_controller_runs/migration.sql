-- CreateTable
CREATE TABLE "controller_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "steps" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "controller_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "controller_runs_user_id_day_key" ON "controller_runs"("user_id", "day");

-- AddForeignKey
ALTER TABLE "controller_runs" ADD CONSTRAINT "controller_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

